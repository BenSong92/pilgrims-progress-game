// ============================================================
// 천로역정 (Pilgrim's Progress) 협동 장애물 코스 — 공유 레벨 데이터
// 서버(Node, 물리 충돌 계산)와 클라이언트(브라우저, 렌더링)가 동일한
// 이 파일을 그대로 불러써서 지형과 장애물의 움직임을 항상 일치시킨다.
// 순수 데이터 + 수학 함수만 포함 (엔진 전용 클래스 사용 금지).
//
// 점프 물리(서버 상수와 맞춤): 최대속도 15, 점프속도 14, 중력 -28
//   => 정점 높이 3.5, 체공시간 1.0s, 최대 수평 도달거리 15
// 안전 마진을 위해 실제 간격은 이보다 훨씬 여유있게 설계한다
//   (같은 높이 점프 간격 ≤ 8, 단차 ≤ 2.0).
// ⚠ 아래에서 스테이지가 진행될수록 난이도를 올릴 때도 이 상한선(간격 ≤8, 단차 ≤2.0)은
//   절대 넘기지 않는다 — "어렵게"는 발판 크기 축소/속도 증가/장애물 수 증가/시야 축소로만
//   구현하고, 점프 자체가 불가능해지는 거리로는 만들지 않는다.
//
// 모션 타입: bob(상하), slide(1축 왕복), slide2d(두 축을 다른 주기로 왕복 — 예측하기 어려운
//   리사주 궤적), pendulum(축 회전 왕복), rotorY(Y축 연속 회전), carousel(rotorY와 동일, 회전
//   발판용), orbit(중심점 둘레를 원으로 공전 — 필요하면 y도 함께 출렁임), blink(주기적으로
//   멀리 치워져 충돌/시야에서 완전히 사라졌다가 다시 나타남 — 사라지기 직전 warnDuration
//   동안 warn=true를 반환해 클라이언트가 깜빡임 경고를 보여줄 수 있게 한다).
// ============================================================

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LEVEL = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const statics = [];
  const kinematics = [];
  const checkpoints = [];
  let sid = 0, kid = 0;

  function addStatic(type, pos, size, color) {
    statics.push({ id: 's' + (sid++), type, pos, size, color });
    return statics[statics.length - 1];
  }
  function addKinematic(type, pos, size, color, motion) {
    kinematics.push({ id: 'k' + (kid++), type, pos, size, color, motion });
    return kinematics[kinematics.length - 1];
  }
  function addCheckpoint(id, pos, radius, label) {
    checkpoints.push({ id, pos, radius, label });
  }

  // x축을 따라 왼쪽 끝(edge) 좌표를 계속 갱신하며 이어붙인다.
  let edge = 0; // 다음에 배치할 구조물의 왼쪽(뒤쪽) x 경계
  let y = 0;    // 현재 발판 표면(top) 높이

  function platform(width, depth, color, zAtCenter = 0) {
    const p = addStatic('box', { x: edge + width / 2, y: y - 0.5, z: zAtCenter }, { x: width, y: 1, z: depth }, color);
    edge += width;
    return p;
  }

  // =================================================================
  // ZONE A — 멸망의 도시 (City of Destruction) : 시작 지점 (튜토리얼 — 쉬움)
  // =================================================================
  platform(28, 24, '#8a7a63');
  const spawn = { x: 10, y: y + 2, z: 0 };
  addCheckpoint('cp0', { x: edge - 8, y: y + 1, z: 0 }, 7, '멸망의 도시');

  // =================================================================
  // ZONE B — 낙담의 늪 (Slough of Despond) : 흔들리는 디딤돌
  // 뒤로 갈수록 발판이 좁아지고(정밀도 요구 증가) 더 빨리/크게 출렁인다(타이밍 요구 증가).
  // 좌우 지그재그 폭(±3.2)과 점프 간격 상한(≤6.5)은 안전을 위해 고정.
  // =================================================================
  addStatic('plane_hazard', { x: edge + 62, y: y - 7, z: 0 }, { x: 140, y: 1, z: 30 }, '#4a3d2a');
  const stoneW0 = 5, stoneWMin = 4.4;
  const stoneGap0 = 5.0, stoneGapMax = 6.2; // 검증된 안전 반경(≤8) 안에서만 넓어짐
  edge += 4; // 첫 디딤돌까지 약간의 助走 간격
  const sloughStones = 12; // 기존 10개 → 늪을 더 길고 힘겹게
  for (let i = 0; i < sloughStones; i++) {
    const prog = i / (sloughStones - 1);
    const ease = Math.pow(prog, 1.6); // 초반은 원래 난이도만큼 여유있게, 후반에 몰아서 어려워짐
    const w = stoneW0 - (stoneW0 - stoneWMin) * ease;
    const gap = stoneGap0 + (stoneGapMax - stoneGap0) * ease;
    const x = edge + w / 2;
    const z = (i % 2 === 0 ? -3.2 : 3.2); // 지그재그 폭은 고정 — 늘리면 대각선 점프 거리가 안전선을 넘어감
    const amp = 0.3 + ease * 0.35;
    const speed = 1.1 + ease * 0.7;
    addKinematic('box', { x, y, z }, { x: w, y: 1, z: w }, '#5c4a2e', {
      type: 'bob', amplitude: amp, speed, phase: i * 0.8, axis: 'y',
    });
    edge += w + gap;
  }
  edge += 2;
  platform(14, 24, '#8a7a63');
  addCheckpoint('cp1', { x: edge - 7, y: y + 1, z: 0 }, 7, '낙담의 늪을 건너다');

  // =================================================================
  // ZONE C — 좁은 문 (Wicket Gate)
  // 문에 이르기 전에 서로 다른 박자로 흔들리는 장대 2개를 연달아 통과해야 한다.
  // =================================================================
  platform(52, 24, '#8a7a63');
  const gateX = edge - 20;
  addStatic('box', { x: gateX, y: y + 6, z: -4.2 }, { x: 3, y: 12, z: 2.4 }, '#4a3f33');
  addStatic('box', { x: gateX, y: y + 6, z: 4.2 }, { x: 3, y: 12, z: 2.4 }, '#4a3f33');
  addStatic('box', { x: gateX, y: y + 13, z: 0 }, { x: 3, y: 2, z: 11 }, '#4a3f33');
  addKinematic('bar', { x: gateX - 20, y: y + 4.2, z: 0 }, { x: 1.2, y: 1.2, z: 10 }, '#7a2424', {
    type: 'pendulum', amplitude: 0.55, speed: 1.9, phase: Math.PI, pivot: 'x',
  });
  addKinematic('bar', { x: gateX - 10, y: y + 4.5, z: 0 }, { x: 1.2, y: 1.2, z: 11 }, '#9a2e2e', {
    type: 'pendulum', amplitude: 0.75, speed: 1.4, phase: 0, pivot: 'x',
  });
  addCheckpoint('cp2', { x: edge - 7, y: y + 1, z: 0 }, 7, '좁은 문을 지나다');

  // =================================================================
  // ZONE D — 고난의 언덕 (Hill Difficulty) : 계단 + 굴러오는 장애물
  // 계단 수를 늘리고 구르는 장애물도 2개→4개로 늘렸다. 마지막 두 계단은 발판이 좁아지고,
  // 맨 위의 장애물은 예측하기 어려운 리사주 궤적(slide2d)으로 움직인다.
  // =================================================================
  const stepRise = 1.6, stepDepth = 20;
  const hillSteps = 10; // 기존 9 → 한 칸 더
  const stepW = 9, stepWNarrow = 7;
  const hillRollers = [];
  for (let i = 0; i < hillSteps; i++) {
    const narrowed = i >= hillSteps - 2;
    const w = narrowed ? stepWNarrow : stepW;
    platform(w, stepDepth, '#7a6a52');
    y += stepRise;
    if (i === 2 || i === 4 || i === 6) {
      hillRollers.push({ x: edge - w / 2, y: y + 2.5, kind: 'slide' });
    } else if (i === 8) {
      hillRollers.push({ x: edge - w / 2, y: y + 2.8, kind: 'slide2d' });
    }
  }
  hillRollers.forEach((r, i) => {
    if (r.kind === 'slide2d') {
      addKinematic('sphere', { x: r.x, y: r.y, z: 0 }, { r: 2 }, '#3a2c1a', {
        type: 'slide2d', ampX: 2.4, speedX: 1.3, phaseX: 0, ampZ: 5, speedZ: 0.9, phaseZ: 1.4,
      });
    } else {
      addKinematic('sphere', { x: r.x, y: r.y, z: 0 }, { r: 2 }, '#5a4530', {
        type: 'slide', amplitude: 5.5, speed: 1.1 + i * 0.2, phase: i * 1.7, axis: 'z',
      });
    }
  });
  platform(16, 22, '#8a7a63');
  addCheckpoint('cp3', { x: edge - 8, y: y + 1, z: 0 }, 8, '고난의 언덕을 오르다');

  // =================================================================
  // ZONE E — 사망의 음침한 골짜기 (Valley of the Shadow of Death)
  // 좁고 어두운 다리: 회전하는 낫 모양 장대 5개(기존 3개) + 다리 중간에 주기적으로
  // 완전히 사라졌다 나타나는 발판(blink) 구간. 시야/조명은 client.js의 ZONE_THEMES에서
  // 가장 어둡게 처리해 "음침한 골짜기"의 공포감을 살린다.
  // =================================================================
  const bridgeStart = edge;
  addStatic('plane_hazard', { x: bridgeStart + 42, y: y - 7, z: 0 }, { x: 100, y: 1, z: 26 }, '#0a0a0f');
  platform(34, 4.2, '#232019');
  addKinematic('bar', { x: bridgeStart + 10, y: y + 1.5, z: 0 }, { x: 1, y: 1, z: 8 }, '#8c3b2e', {
    type: 'rotorY', speed: 1.0, phase: 0,
  });
  addKinematic('bar', { x: bridgeStart + 24, y: y + 1.7, z: 0 }, { x: 1, y: 1, z: 9 }, '#8c3b2e', {
    type: 'rotorY', speed: 1.15, phase: 1.1,
  });
  // 사라졌다 나타나기를 반복하는 발판. onDuration(보이는 시간)이 통과에 필요한 시간
  // (간격 10 ÷ 최대속도 15 ≈ 0.67s)보다 훨씬 넉넉해서 불공평하지 않다 — 다만 늦게 들어서면
  // 사라지기 직전 경고(warn) 구간에 걸릴 수 있어 정말로 "타이밍을 보는" 긴장감을 준다.
  addKinematic('box', { x: edge + 5, y: y - 0.5, z: 0 }, { x: 10, y: 1, z: 4.2 }, '#5a2e2e', {
    type: 'blink', period: 3.4, onDuration: 2.0, warnDuration: 0.7, phase: 0,
  });
  edge += 10;
  platform(40, 4.2, '#232019');
  addKinematic('bar', { x: bridgeStart + 50, y: y + 1.5, z: 0 }, { x: 1, y: 1, z: 8 }, '#8c3b2e', {
    type: 'rotorY', speed: 1.3, phase: 2.0,
  });
  addKinematic('bar', { x: bridgeStart + 64, y: y + 1.7, z: 0 }, { x: 1, y: 1, z: 9 }, '#8c3b2e', {
    type: 'rotorY', speed: 1.45, phase: 0.5,
  });
  addKinematic('bar', { x: bridgeStart + 76, y: y + 1.6, z: 0 }, { x: 1, y: 1, z: 8 }, '#8c3b2e', {
    type: 'rotorY', speed: 1.6, phase: 2.6,
  });
  platform(16, 22, '#8a7a63');
  addCheckpoint('cp4', { x: edge - 8, y: y + 1, z: 0 }, 8, '음침한 골짜기를 지나다');

  // =================================================================
  // ZONE F — 허영의 시장 (Vanity Fair) : 내려가는 계단 + 회전 무대 + 곡예 그네
  // 회전 발판을 3개→4개로 늘리고 방향을 번갈아 바꿨다. 각 발판 위에는 반대로 도는
  // 곡예 그네(orbit)가 있어 회전판 위에서 균형을 잡으면서 동시에 피해야 한다.
  // =================================================================
  const fairSteps = 4;
  for (let i = 0; i < fairSteps; i++) {
    platform(8, 18, '#7a6a52');
    y -= 1.7;
  }
  platform(14, 24, '#c9a53f');
  const carouselGap = 6.5, carouselR = 6.5;
  const carouselColors = ['#c9527a', '#4fa9c9', '#e0b23a', '#8e5ac9'];
  const fairCarousels = 4; // 기존 3개
  for (let i = 0; i < fairCarousels; i++) {
    edge += carouselGap;
    const cx = edge + carouselR;
    const dir = (i % 2 === 0) ? 1 : -1;
    addKinematic('cylinder', { x: cx, y, z: 0 }, { r: carouselR, h: 1 }, carouselColors[i % carouselColors.length], {
      type: 'carousel', speed: dir * (0.8 + i * 0.18), phase: i * 1.3,
    });
    addKinematic('sphere', { x: cx, y: y + 2.6, z: 0 }, { r: 1.1 }, '#3a2a1a', {
      type: 'orbit', radius: carouselR * 0.8, speed: -dir * (1.3 + i * 0.2), phase: i * 0.9,
    });
    edge += carouselR * 2;
  }
  edge += carouselGap;
  platform(16, 24, '#8a7a63');
  addCheckpoint('cp5', { x: edge - 8, y: y + 1, z: 0 }, 8, '허영의 시장을 벗어나다');

  // =================================================================
  // ZONE G — 죽음의 강 / 요단강 (The River) : 점점 작아지고 빨라지는 연잎 + 떠내려오는 통나무
  // 발판 수를 8개→10개로 늘리고, 갈수록 반지름이 작아진다(점프 간격 자체는 고정해 안전 유지).
  // 강 한복판에는 원 궤도로 도는 통나무가 있어 마지막 시험답게 타이밍 회피가 필요하다.
  // =================================================================
  addStatic('plane_hazard', { x: edge + 50, y: y - 7, z: 0 }, { x: 110, y: 1, z: 28 }, '#1c4a63');
  const padGap = 6.5; // 안전 반경(≤8) 안에서 고정 — 난이도는 발판 크기/속도로만 올린다
  edge += 4;
  const lilypads = 10; // 기존 8개
  for (let i = 0; i < lilypads; i++) {
    const prog = i / (lilypads - 1);
    const padRi = 3.0 - 0.7 * prog; // 갈수록 발판이 작아짐
    const x = edge + padRi;
    const z = Math.sin(i * 1.3) * 4.5;
    addKinematic('cylinder', { x, y, z }, { r: padRi, h: 0.8 }, '#2f7a4e', {
      type: 'bob', amplitude: 0.3 + prog * 0.35, speed: 1.5 + prog * 0.9, phase: i * 0.9, axis: 'y',
    });
    if (i === 5) {
      addKinematic('sphere', { x: x + padRi + 3, y: y + 1.4, z: 0 }, { r: 1.6 }, '#4a3a22', {
        type: 'orbit', radius: 5.5, speed: 1.1, phase: 0,
      });
    }
    edge += padRi * 2 + padGap;
  }
  addCheckpoint('cpR', { x: edge + 4, y: y + 1, z: 0 }, 6, '요단강을 건너 하늘의 도성을 바라보다');

  // =================================================================
  // ZONE H — 하늘의 도성 (Celestial City) : 목적지
  // =================================================================
  const cityStart = edge;
  platform(60, 44, '#e9d38a');
  for (const dz of [-17, 17]) {
    for (let i = 0; i < 3; i++) {
      addStatic('cylinder', { x: cityStart + 12 + i * 16, y: y + 9.5, z: dz }, { r: 2.4, h: 20 }, '#f4e6b0');
    }
  }
  const goalPos = { x: cityStart + 30, y: y + 1, z: 0 };
  const goal = { pos: goalPos, radius: 18 };
  addCheckpoint('cp6', goalPos, goal.radius, '하늘의 도성 (목적지)');

  const fallY = -15;

  // ---------------------------------------------------------------
  // 모든 클라이언트/서버가 공통으로 사용하는 위치 계산 함수.
  // t = 레벨 시작 이후 경과 시간(초). 순수 함수 — 항상 서버와 동일한 결과.
  // visible/warn은 blink 타입에서만 의미가 있다(그 외 타입은 항상 visible=true, warn=false).
  // ---------------------------------------------------------------
  function kinematicTransform(piece, t) {
    const m = piece.motion;
    let pos = { x: piece.pos.x, y: piece.pos.y, z: piece.pos.z };
    let angle = { x: 0, y: 0, z: 0 };
    let visible = true;
    let warn = false;

    if (m.type === 'bob') {
      pos.y += Math.sin(m.speed * t + m.phase) * m.amplitude;
    } else if (m.type === 'slide') {
      pos[m.axis] += Math.sin(m.speed * t + m.phase) * m.amplitude;
    } else if (m.type === 'slide2d') {
      pos.x += Math.sin(m.speedX * t + m.phaseX) * m.ampX;
      pos.z += Math.sin(m.speedZ * t + m.phaseZ) * m.ampZ;
    } else if (m.type === 'pendulum') {
      const ang = Math.sin(m.speed * t + m.phase) * m.amplitude;
      if (m.pivot === 'x') angle.x = ang; else angle.z = ang;
    } else if (m.type === 'rotorY') {
      angle.y = (m.speed * t + m.phase) % (Math.PI * 2);
    } else if (m.type === 'carousel') {
      angle.y = (m.speed * t + m.phase) % (Math.PI * 2);
    } else if (m.type === 'orbit') {
      const a = m.speed * t + m.phase;
      pos.x = piece.pos.x + Math.cos(a) * m.radius;
      pos.z = piece.pos.z + Math.sin(a) * m.radius;
      if (m.bobAmplitude) pos.y += Math.sin(a * (m.bobSpeedMul || 1)) * m.bobAmplitude;
    } else if (m.type === 'blink') {
      const period = m.period;
      const cyc = ((t + m.phase) % period + period) % period;
      visible = cyc < m.onDuration;
      const warnStart = m.onDuration - (m.warnDuration || 0.6);
      warn = visible && cyc >= warnStart;
      if (!visible) pos.y -= (m.parkOffset || 60);
    }
    return { pos, angle, visible, warn };
  }

  return { spawn, fallY, statics, kinematics, checkpoints, goal, kinematicTransform };
});
