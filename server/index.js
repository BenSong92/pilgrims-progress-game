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
const JUMP_SPEED = 14;
const PLAYER_RADIUS = 1.4;
const GROUP_GROUND = 1;
const GROUP_PLAYER = 2;

const COLORS = ['#c0392b', '#2e7d32', '#1f6fb2', '#c99a2e', '#8e44ad', '#16a085', '#d35400', '#7f8c8d'];

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
const httpServer = require('http').createServer(app);
const io = new Server(httpServer);

// ---------- physics world ----------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -28, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = false;

const groundBody = null; // (전용 지면 없음 — 모든 발판이 static 박스로 구성됨)

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
  const body = new CANNON.Body({ mass: 0, shape, collisionFilterGroup: GROUP_GROUND, collisionFilterMask: GROUP_PLAYER });
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
    position: new CANNON.Vec3(pos.x, pos.y, pos.z),
    fixedRotation: true,
    linearDamping: 0.25,
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
setInterval(() => {
  const t = elapsed();

  LEVEL.kinematics.forEach((piece) => {
    if (!piece.body) return;
    const { pos, angle } = LEVEL.kinematicTransform(piece, t);
    piece.body.position.set(pos.x, pos.y, pos.z);
    piece.body.quaternion.setFromEuler(angle.x, angle.y, angle.z);
  });

  players.forEach((p) => {
    const grounded = isGrounded(p.body);
    p.body.velocity.x = p.input.x * MAX_SPEED;
    p.body.velocity.z = p.input.z * MAX_SPEED;
    if (p.input.jump && grounded) {
      p.body.velocity.y = JUMP_SPEED;
    }
  });

  world.step(DT);

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
