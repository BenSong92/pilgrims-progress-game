// ============================================================
// 천로역정 협동 장애물 코스 — 클라이언트 (Three.js 렌더링 + Socket.IO 동기화)
// ============================================================

const els = {};
let scene, camera, renderer, clock;
let socket = null;
let myId = null;
let levelStart = 0;
let serverOffset = 0;
let camYaw = 0.15;
const keys = {};
let jumpQueued = false;
let dragging = false, lastPointerX = 0;

const entities = new Map(); // id -> { mesh, name, color, current:{x,y,z}, target:{x,y,z}, yaw }
const kinematicMeshes = []; // parallel to LEVEL.kinematics

window.addEventListener('DOMContentLoaded', init);

function init() {
  cacheDom();
  bindUi();
  initThree();
  buildLevelMeshes();

  window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') jumpQueued = true;
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('resize', onResize);

  clock = new THREE.Clock();
  requestAnimationFrame(loop);
}

function cacheDom() {
  els.lobby = document.getElementById('screen-lobby');
  els.world = document.getElementById('screen-world');
  els.nameInput = document.getElementById('name-input');
  els.btnJoin = document.getElementById('btn-join');
  els.lobbyStatus = document.getElementById('lobby-status');
  els.canvasWrap = document.getElementById('canvas-wrap');
  els.zoneName = document.getElementById('zone-name');
  els.roster = document.getElementById('roster');
  els.fallenHint = document.getElementById('fallen-hint');
  els.victory = document.getElementById('victory-overlay');
  els.toast = document.getElementById('toast');
}

function bindUi() {
  els.btnJoin.addEventListener('click', joinGame);
  els.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
}

function joinGame() {
  if (socket) return;
  els.btnJoin.disabled = true;
  els.lobbyStatus.textContent = '서버에 접속하는 중...';
  socket = io();

  socket.on('connect', () => {
    socket.emit('join', { name: els.nameInput.value });
  });
  socket.on('connect_error', () => {
    els.lobbyStatus.textContent = '서버에 접속할 수 없습니다. 잠시 후 다시 시도해주세요.';
    els.btnJoin.disabled = false;
  });
  socket.on('joined', (data) => {
    myId = data.id;
    levelStart = data.levelStart;
    els.lobby.classList.add('hidden');
    els.world.classList.remove('hidden');
  });
  socket.on('roster', renderRoster);
  socket.on('state', onState);
  socket.on('victory', () => els.victory.classList.remove('hidden'));
}

function renderRoster(list) {
  els.roster.innerHTML = '';
  list.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'roster-item' + (p.arrived ? ' arrived' : '');
    row.innerHTML = `<span class="roster-dot" style="background:${p.color}"></span><span>${escapeHtml(p.name)}</span>${p.arrived ? '<span class="roster-check">✔</span>' : ''}`;
    els.roster.appendChild(row);
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---------- three.js ----------
function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb8c9);
  scene.fog = new THREE.Fog(0x9fb8c9, 120, 420);

  camera = new THREE.PerspectiveCamera(62, 1, 0.5, 1500);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  els.canvasWrap.appendChild(renderer.domElement);
  onResize();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 0.95));
  const sun = new THREE.DirectionalLight(0xfff3d6, 0.85);
  sun.position.set(150, 260, 100);
  scene.add(sun);

  renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; lastPointerX = e.clientX; });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastPointerX;
    lastPointerX = e.clientX;
    camYaw -= dx * 0.006;
  });
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function makeTextSprite(text, { size = 26, color = '#2a2016', bg = 'rgba(251,242,221,0.85)', scale = 8 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const padding = 12;
  ctx.font = `bold ${size}px sans-serif`;
  const width = Math.ceil(ctx.measureText(text).width) + padding * 2;
  const height = size + padding * 2;
  canvas.width = width; canvas.height = height;
  ctx.font = `bold ${size}px sans-serif`;
  if (bg) {
    ctx.fillStyle = bg;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(0, 0, width, height, 10); ctx.fill(); }
    else ctx.fillRect(0, 0, width, height);
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2 + 1);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const aspect = width / height;
  sprite.scale.set(scale * aspect, scale, 1);
  return sprite;
}

// ---------- level geometry ----------
function buildLevelMeshes() {
  LEVEL.statics.forEach((piece) => {
    const mesh = buildPieceMesh(piece);
    if (mesh) {
      mesh.position.set(piece.pos.x, piece.pos.y, piece.pos.z);
      scene.add(mesh);
    }
  });
  LEVEL.kinematics.forEach((piece) => {
    const mesh = buildPieceMesh(piece);
    scene.add(mesh);
    kinematicMeshes.push(mesh);
  });
}

function buildPieceMesh(piece) {
  const mat = new THREE.MeshLambertMaterial({ color: piece.color || '#8a7a63' });
  if (piece.type === 'box' || piece.type === 'bar') {
    return new THREE.Mesh(new THREE.BoxGeometry(piece.size.x, piece.size.y, piece.size.z), mat);
  }
  if (piece.type === 'cylinder') {
    return new THREE.Mesh(new THREE.CylinderGeometry(piece.size.r, piece.size.r, piece.size.h, 20), mat);
  }
  if (piece.type === 'sphere') {
    return new THREE.Mesh(new THREE.SphereGeometry(piece.size.r, 16, 12), mat);
  }
  if (piece.type === 'plane_hazard') {
    mat.transparent = true;
    mat.opacity = 0.92;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(piece.size.x, piece.size.z), mat);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }
  return null;
}

// ---------- player figures ----------
function buildPlayerFigure(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.4, 3.6, 10),
    new THREE.MeshLambertMaterial({ color })
  );
  body.position.y = 2.6;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(1.05, 12, 10),
    new THREE.MeshLambertMaterial({ color: '#e0b088' })
  );
  head.position.y = 5.4;
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 1, 8),
    new THREE.MeshLambertMaterial({ color: '#2a2016' })
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 3, 1.3);
  g.add(body, head, nose);
  return g;
}

function ensureEntity(p) {
  let e = entities.get(p.id);
  if (!e) {
    const mesh = buildPlayerFigure(p.color);
    const label = makeTextSprite(p.name, { scale: 7 });
    label.position.y = 8;
    mesh.add(label);
    scene.add(mesh);
    e = { mesh, current: { ...p.pos }, target: { ...p.pos }, yaw: p.yaw || 0, name: p.name };
    entities.set(p.id, e);
  }
  e.target.x = p.pos.x; e.target.y = p.pos.y; e.target.z = p.pos.z;
  e.yaw = p.yaw;
  return e;
}

let prevSelfPos = null;
function onState(data) {
  serverOffset = data.serverNow - Date.now();

  const seen = new Set();
  data.players.forEach((p) => {
    seen.add(p.id);
    ensureEntity(p);
  });

  // 접속이 끊긴 플레이어 정리
  Array.from(entities.keys()).forEach((id) => {
    if (!seen.has(id)) {
      const e = entities.get(id);
      scene.remove(e.mesh);
      entities.delete(id);
    }
  });

  const self = data.players.find((p) => p.id === myId);
  if (self) {
    if (prevSelfPos) {
      const dist = Math.hypot(self.pos.x - prevSelfPos.x, self.pos.y - prevSelfPos.y, self.pos.z - prevSelfPos.z);
      if (dist > 10) showFallenHint();
    }
    prevSelfPos = { ...self.pos };
    const cp = LEVEL.checkpoints[self.checkpoint];
    if (cp) els.zoneName.textContent = cp.label;
  }
}

let fallenTimer = null;
function showFallenHint() {
  els.fallenHint.classList.remove('hidden');
  clearTimeout(fallenTimer);
  fallenTimer = setTimeout(() => els.fallenHint.classList.add('hidden'), 2200);
}

// ---------- input & camera ----------
function computeMoveVec() {
  const ix = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
  const iz = (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0);
  if (ix === 0 && iz === 0) return { x: 0, z: 0 };
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
  let x = fx * iz + rx * ix;
  let z = fz * iz + rz * ix;
  const len = Math.hypot(x, z) || 1;
  return { x: x / len, z: z / len };
}

function sendInput() {
  if (!socket || !myId) return;
  const move = computeMoveVec();
  const e = entities.get(myId);
  if (e && (move.x !== 0 || move.z !== 0)) {
    e.yaw = Math.atan2(move.x, move.z);
  }
  socket.emit('input', { x: move.x, z: move.z, jump: jumpQueued, yaw: e ? e.yaw : 0 });
  jumpQueued = false;
}

// ---------- loop ----------
function loop() {
  const dt = Math.min(0.05, clock.getDelta());

  if (myId) {
    sendInput();

    const t = (Date.now() + serverOffset - levelStart) / 1000;
    LEVEL.kinematics.forEach((piece, i) => {
      const { pos, angle } = LEVEL.kinematicTransform(piece, t);
      const mesh = kinematicMeshes[i];
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.rotation.set(angle.x, angle.y, angle.z);
    });

    const smooth = 1 - Math.pow(0.001, dt);
    entities.forEach((e) => {
      e.current.x += (e.target.x - e.current.x) * smooth;
      e.current.y += (e.target.y - e.current.y) * smooth;
      e.current.z += (e.target.z - e.current.z) * smooth;
      e.mesh.position.set(e.current.x, e.current.y, e.current.z);
      e.mesh.rotation.y = e.yaw;
    });

    const self = entities.get(myId);
    if (self) {
      const dist = 26, height = 13;
      const camX = self.current.x - Math.sin(camYaw) * dist;
      const camZ = self.current.z - Math.cos(camYaw) * dist;
      camera.position.set(camX, self.current.y + height, camZ);
      camera.lookAt(self.current.x, self.current.y + 3, self.current.z);
    }

    renderer.render(scene, camera);
  }

  requestAnimationFrame(loop);
}
