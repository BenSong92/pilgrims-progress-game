// ============================================================
// 천로역정 협동 장애물 코스 — 서버 (권위 있는 물리 시뮬레이션)
// ============================================================

const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const CANNON = require('cannon-es');
const LEVEL = require('../shared/level.js');

const PORT = process.env.PORT || 3000;
const TICK_RATE = 60;
const DT = 1 / TICK_RATE;
const MAX_SPEED = 15;
const PLAYER_RADIUS = 1.4;
const GROUP_GROUND = 1;
const GROUP_PLAYER = 2;

// ---------- 마리오풍 점프 보정 ----------
const JUMP_SPEED = 14;          // 점프 버튼을 끝까지 눌렀을 때 초기 상승 속도
const COYOTE_MS = 120;          // 발판에서 떨어진 뒤에도 점프를 허용하는 유예시간
const JUMP_BUFFER_MS = 150;     // 착지 직전에 미리 누른 점프를 기억해두는 시간
const SHORT_HOP_CUT = 0.45;     // 상승 중 점프 버튼을 일찍 떼면 상승 속도에 곱하는 배율 (가변 점프 높이)
const GRAVITY_RISE = 28;        // 상승 구간 중력
const GRAVITY_FALL = 42;        // 하강 구간 중력 (더 강하게 — 스냅감 있는 낙하)
const GRAVITY_APEX = 12;        // 정점 부근 중력 (살짝 붕 뜨는 행타임)
const APEX_VY_THRESHOLD = 4;    // 이 속도 이하일 때 "정점 부근"으로 간주

const COLORS = ['#c0392b', '#2e7d32', '#1f6fb2', '#c99a2e', '#8e44ad', '#16a085', '#d35400', '#7f8c8d'];

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
const httpServer = require('http').createServer(app);
const io = new Server(httpServer);

// ---------- physics world ----------
// 중력은 world 전역이 아니라 플레이어별로 상승/정점/하강 구간을 나눠 수동 적용한다
// (마리오풍 점프 곡선을 위해). 따라서 world 자체의 중력은 0으로 둔다.
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = false;

// 캐릭터는 매 틱 속도를 직접 지정해서 움직이므로(마찰로 가감속하지 않음),
// 기본 마찰이 남아있으면 지면과의 접촉 마찰이 매 스텝 속도를 갉아먹어
// 실제 이동속도가 MAX_SPEED보다 한참 느려지는 문제가 생긴다. 마찰/반발 0으로 고정.
const groundMaterial = new CANNON.Material('ground');
const playerMaterial = new CANNON.Material('player');
world.addContactMaterial(new CANNON.ContactMaterial(groundMaterial, playerMaterial, {
  friction: 0,
  restitution: 0,
}));

function makeStaticBody(piece) {
  if (piece.type === 'plane_hazard') return null; // 시각 전용, 충돌체 없음
  let shape;
  if (piece.type === 'box') {
    shape = new CANNON.Box(new CANNON.Vec3(piece.size.x / 2, piece.size.y / 2, piece.size.z / 2));
  } else if (piece.type === 'cylinder') {
    shape = new CANNON.Cylinder(piece.size.r, piece.size.r, piece.size.h, 16);
  } else {
    return null;
  }
  const body = new CANNON.Body({
    mass: 0, shape, material: groundMaterial,
    collisionFilterGroup: GROUP_GROUND, collisionFilterMask: GROUP_PLAYER,
  });
  body.position.set(piece.pos.x, piece.pos.y, piece.pos.z);
  world.addBody(body);
  return body;
}

function makeKinematicBody(piece) {
  let shape;
  if (piece.type === 'box' || piece.type === 'bar') {
    shape = new CANNON.Box(new CANNON.Vec3(piece.size.x / 2, piece.size.y / 2, piece.size.z / 2));
  } else if (piece.type === 'sphere') {
    shape = new CANNON.Sphere(piece.size.r);
  } else if (piece.type === 'cylinder') {
    shape = new CANNON.Cylinder(piece.size.r, piece.size.r, piece.size.h, 16);
  } else {
    return null;
  }
  const body = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.KINEMATIC,
    shape,
    material: groundMaterial,
    collisionFilterGroup: GROUP_GROUND,
    collisionFilterMask: GROUP_PLAYER,
  });
  body.position.set(piece.pos.x, piece.pos.y, piece.pos.z);
  world.addBody(body);
  return body;
}

LEVEL.statics.forEach((p) => { p.body = makeStaticBody(p); });
LEVEL.kinematics.forEach((p) => { p.body = makeKinematicBody(p); });

const levelStart = Date.now();
function elapsed() { return (Date.now() - levelStart) / 1000; }

// ---------- checkpoint ordering ----------
const cpIndex = {};
LEVEL.checkpoints.forEach((cp, i) => { cpIndex[cp.id] = i; });

// ---------- players ----------
const players = new Map(); // socketId -> player state
let colorCursor = 0;

function spawnPosition() {
  const jitter = () => (Math.random() - 0.5) * 3;
  return { x: LEVEL.spawn.x + jitter(), y: LEVEL.spawn.y + 2, z: LEVEL.spawn.z + jitter() };
}

function createPlayer(socket, name) {
  const pos = spawnPosition();
  const shape = new CANNON.Sphere(PLAYER_RADIUS);
  const body = new CANNON.Body({
    mass: 5,
    shape,
    material: playerMaterial,
    position: new CANNON.Vec3(pos.x, pos.y, pos.z),
    fixedRotation: true,
    linearDamping: 0,   // 속도를 매 틱 직접 지정하므로 감쇠는 불필요 (점프 물리와 간섭만 함)
    angularDamping: 0,
    collisionFilterGroup: GROUP_PLAYER,
    collisionFilterMask: GROUP_GROUND,
  });
  world.addBody(body);

  const color = COLORS[colorCursor % COLORS.length];
  colorCursor++;

  const player = {
    id: socket.id,
    name: name && name.trim() ? name.trim().slice(0, 16) : '순례자',
    color,
    body,
    yaw: 0,
    input: { x: 0, z: 0, jump: false },
    prevInputJump: false,
    wasGrounded: false,
    lastGroundedAt: -Infinity,
    jumpBufferedAt: -Infinity,
    jumpFiredThisContact: false,
    jumpCut: false,
    lastCheckpoint: 'cp0',
    lastCheckpointPos: { ...LEVEL.spawn, y: LEVEL.spawn.y + 2 },
    arrived: false,
  };
  players.set(socket.id, player);
  return player;
}

function removePlayer(socket) {
  const p = players.get(socket.id);
  if (!p) return;
  world.removeBody(p.body);
  players.delete(socket.id);
}

function broadcastRoster() {
  io.emit('roster', Array.from(players.values()).map((p) => ({
    id: p.id, name: p.name, color: p.color, arrived: p.arrived,
  })));
}

function isGrounded(body) {
  const from = new CANNON.Vec3(body.position.x, body.position.y - PLAYER_RADIUS + 0.05, body.position.z);
  const to = new CANNON.Vec3(body.position.x, body.position.y - PLAYER_RADIUS - 0.55, body.position.z);
  const result = new CANNON.RaycastResult();
  world.raycastClosest(from, to, { collisionFilterMask: GROUP_GROUND }, result);
  return result.hasHit;
}

let victoryFired = false;

function checkAllArrived() {
  if (victoryFired) return;
  const list = Array.from(players.values());
  if (list.length === 0) return;
  if (list.every((p) => p.arrived)) {
    victoryFired = true;
    io.emit('victory');
  }
}

// ---------- socket.io ----------
io.on('connection', (socket) => {
  socket.on('join', (data) => {
    const player = createPlayer(socket, data && data.name);
    socket.emit('joined', { id: socket.id, spawn: player.lastCheckpointPos, color: player.color, levelStart });
    broadcastRoster();
  });

  socket.on('input', (data) => {
    const p = players.get(socket.id);
    if (!p || !data) return;
    p.input.x = clampNum(data.x, -1, 1);
    p.input.z = clampNum(data.z, -1, 1);
    p.input.jump = !!data.jump;
    p.yaw = typeof data.yaw === 'number' ? data.yaw : p.yaw;
  });

  socket.on('disconnect', () => {
    removePlayer(socket);
    broadcastRoster();
    checkAllArrived();
  });
});

function clampNum(v, lo, hi) {
  v = typeof v === 'number' && !isNaN(v) ? v : 0;
  return Math.max(lo, Math.min(hi, v));
}

// ---------- fixed-step simulation loop ----------
// Windows에서는 setInterval(16.7ms)이 타이머 해상도 문제로 실제로는 더 느리게(약 30Hz)
// 호출되는 경우가 있다. world.step에 고정 DT만 넘기면 그만큼 시뮬레이션 전체가 "슬로우 모션"처럼
// 느려지므로(이동 속도·점프 궤적 모두 영향), 실제 경과 시간을 측정해서 필요한 만큼 서브스텝을 돌린다.
let lastTickTime = Date.now();
setInterval(() => {
  const t = elapsed();
  const now = Date.now();
  const timeSinceLastCalled = (now - lastTickTime) / 1000;
  lastTickTime = now;

  LEVEL.kinematics.forEach((piece) => {
    if (!piece.body) return;
    const { pos, angle } = LEVEL.kinematicTransform(piece, t);
    piece.body.position.set(pos.x, pos.y, pos.z);
    piece.body.quaternion.setFromEuler(angle.x, angle.y, angle.z);
  });

  const simDt = Math.min(timeSinceLastCalled, DT * 5); // cannon의 maxSubSteps(5)와 동일하게 캡핑

  players.forEach((p) => {
    const grounded = isGrounded(p.body);
    if (grounded && !p.wasGrounded) {
      p.jumpFiredThisContact = false; // 새로 착지하는 순간 — 다시 점프할 수 있게 허용
    }
    if (grounded) {
      p.lastGroundedAt = now;
      p.jumpCut = false;
    }
    p.wasGrounded = grounded;

    // 점프 입력의 "누른 순간"만 버퍼에 기록 (누르고 있는 동안 계속 갱신되지 않도록)
    if (p.input.jump && !p.prevInputJump) {
      p.jumpBufferedAt = now;
    }
    p.prevInputJump = p.input.jump;

    p.body.velocity.x = p.input.x * MAX_SPEED;
    p.body.velocity.z = p.input.z * MAX_SPEED;

    const withinCoyote = now - p.lastGroundedAt <= COYOTE_MS;
    // 지금 누르고 있거나(착지 전부터 계속 누르고 있던 경우 포함), 착지 직전에 눌렀던 입력이 버퍼 시간 안이면 점프 요청으로 간주
    const jumpRequested = p.input.jump || (now - p.jumpBufferedAt <= JUMP_BUFFER_MS);

    if (withinCoyote && jumpRequested && !p.jumpFiredThisContact) {
      p.body.velocity.y = JUMP_SPEED;
      p.jumpFiredThisContact = true;  // 같은 접지 구간에서 중복 발사 방지
      p.jumpBufferedAt = -Infinity;   // 점프 소비
      p.lastGroundedAt = -Infinity;   // 같은 공중 상태에서 코요테 타임으로 재점프 방지
      p.jumpCut = false;
    } else if (!p.input.jump && p.body.velocity.y > 0 && !p.jumpCut) {
      // 상승 중에 점프 버튼을 일찍 떼면 그 순간 한 번만 상승 속도를 깎는다 (가변 점프 높이)
      p.body.velocity.y *= SHORT_HOP_CUT;
      p.jumpCut = true;
    }

    // 마리오풍 중력: 상승/정점(행타임)/하강 구간마다 다른 세기를 적용
    let g;
    if (p.body.velocity.y > APEX_VY_THRESHOLD) g = GRAVITY_RISE;
    else if (p.body.velocity.y < -APEX_VY_THRESHOLD) g = GRAVITY_FALL;
    else g = GRAVITY_APEX;
    p.body.velocity.y -= g * simDt;
  });

  world.step(DT, timeSinceLastCalled, 5);

  players.forEach((p) => {
    // 낙사 처리
    if (p.body.position.y < LEVEL.fallY) {
      const rp = p.lastCheckpointPos;
      p.body.position.set(rp.x, rp.y, rp.z);
      p.body.velocity.set(0, 0, 0);
    }

    // 체크포인트 갱신 (앞으로만 전진)
    for (const cp of LEVEL.checkpoints) {
      const dx = p.body.position.x - cp.pos.x;
      const dz = p.body.position.z - cp.pos.z;
      if (Math.hypot(dx, dz) < cp.radius) {
        if (cpIndex[cp.id] > cpIndex[p.lastCheckpoint]) {
          p.lastCheckpoint = cp.id;
          p.lastCheckpointPos = { x: cp.pos.x, y: cp.pos.y + 1.5, z: cp.pos.z };
        }
      }
    }

    // 목적지 도착 판정
    if (!p.arrived) {
      const dx = p.body.position.x - LEVEL.goal.pos.x;
      const dz = p.body.position.z - LEVEL.goal.pos.z;
      if (Math.hypot(dx, dz) < LEVEL.goal.radius) {
        p.arrived = true;
        broadcastRoster();
        checkAllArrived();
      }
    }
  });

  io.emit('state', {
    serverNow: Date.now(),
    players: Array.from(players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      pos: { x: p.body.position.x, y: p.body.position.y, z: p.body.position.z },
      yaw: p.yaw,
      checkpoint: cpIndex[p.lastCheckpoint],
      arrived: p.arrived,
    })),
  });
}, 1000 / TICK_RATE);

httpServer.listen(PORT, () => {
  console.log(`Pilgrim's Progress server listening on http://localhost:${PORT}`);
});
