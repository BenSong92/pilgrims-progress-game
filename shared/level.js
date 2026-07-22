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
  // ZONE A — 멸망의 도시 (City of Destruction) : 시작 지점
  // =================================================================
  platform(28, 24, '#8a7a63');
  const spawn = { x: 10, y: y + 2, z: 0 };
  addCheckpoint('cp0', { x: edge - 8, y: y + 1, z: 0 }, 7, '멸망의 도시');

  // =================================================================
  // ZONE B — 낙담의 늪 (Slough of Despond) : 흔들리는 디딤돌
  // =================================================================
  addStatic('plane_hazard', { x: edge + 60, y: y - 7, z: 0 }, { x: 130, y: 1, z: 30 }, '#4a3d2a');
  const stoneW = 5, stoneGap = 5.5; // 발판 간 점프 간격 (안전 마진 확보)
  edge += 4; // 첫 디딤돌까지 약간의 助走 간격
  const sloughStones = 10;
  for (let i = 0; i < sloughStones; i++) {
    const x = edge + stoneW / 2;
    const z = (i % 2 === 0 ? -3.2 : 3.2);
    addKinematic('box', { x, y, z }, { x: stoneW, y: 1, z: stoneW }, '#6b5a3a', {
      type: 'bob', amplitude: 0.45, speed: 1.3, phase: i * 0.8, axis: 'y',
    });
    edge += stoneW + stoneGap;
  }
  edge += 2;
  platform(14, 24, '#8a7a63');
  addCheckpoint('cp1', { x: edge - 7, y: y + 1, z: 0 }, 7, '낙담의 늪을 건너다');

  // =================================================================
  // ZONE C — 좁은 문 (Wicket Gate)
  // =================================================================
  platform(40, 24, '#8a7a63');
  const gateX = edge - 20;
  addStatic('box', { x: gateX, y: y + 6, z: -4.2 }, { x: 3, y: 12, z: 2.4 }, '#4a3f33');
  addStatic('box', { x: gateX, y: y + 6, z: 4.2 }, { x: 3, y: 12, z: 2.4 }, '#4a3f33');
  addStatic('box', { x: gateX, y: y + 13, z: 0 }, { x: 3, y: 2, z: 11 }, '#4a3f33');
  addKinematic('bar', { x: gateX - 10, y: y + 4.5, z: 0 }, { x: 1.2, y: 1.2, z: 11 }, '#9a2e2e', {
    type: 'pendulum', amplitude: 0.75, speed: 1.4, phase: 0, pivot: 'x',
  });
  addCheckpoint('cp2', { x: edge - 7, y: y + 1, z: 0 }, 7, '좁은 문을 지나다');

  // =================================================================
  // ZONE D — 고난의 언덕 (Hill Difficulty) : 계단 + 굴러오는 장애물
  // =================================================================
  const stepRise = 1.6, stepDepth = 20;
  const hillSteps = 9;
  const stepW = 9;
  const hillRollers = [];
  for (let i = 0; i < hillSteps; i++) {
    platform(stepW, stepDepth, '#7a6a52');
    y += stepRise;
    if (i === 2 || i === 5) {
      hillRollers.push({ x: edge - stepW / 2, y: y + 2.5 });
    }
  }
  hillRollers.forEach((r, i) => {
    addKinematic('sphere', { x: r.x, y: r.y, z: 0 }, { r: 2 }, '#5a4530', {
      type: 'slide', amplitude: 5.5, speed: 1.1 + i * 0.15, phase: i * 1.7, axis: 'z',
    });
  });
  platform(16, 22, '#8a7a63');
  addCheckpoint('cp3', { x: edge - 8, y: y + 1, z: 0 }, 8, '고난의 언덕을 오르다');

  // =================================================================
  // ZONE E — 사망의 음침한 골짜기 (Valley of the Shadow of Death)
  // 좁은 다리 + 회전하는 장대 (다리는 끊김 없이 이어짐 — 낙사는 좌우로 밀려날 때)
  // =================================================================
  const bridgeStart = edge;
  platform(96, 5, '#2e2a26');
  for (let i = 0; i < 3; i++) {
    const x = bridgeStart + 16 + i * 30;
    addKinematic('bar', { x, y: y + 1.6, z: 0 }, { x: 1, y: 1, z: 9 }, '#8c3b2e', {
      type: 'rotorY', speed: 1.0 + i * 0.1, phase: i * 1.2,
    });
  }
  platform(16, 22, '#8a7a63');
  addCheckpoint('cp4', { x: edge - 8, y: y + 1, z: 0 }, 8, '음침한 골짜기를 지나다');

  // =================================================================
  // ZONE F — 허영의 시장 (Vanity Fair) : 내려가는 계단 + 회전 무대
  // =================================================================
  const fairSteps = 4;
  for (let i = 0; i < fairSteps; i++) {
    platform(8, 18, '#7a6a52');
    y -= 1.7;
  }
  platform(14, 24, '#c9a53f');
  const carouselGap = 6.5, carouselR = 6.5;
  for (let i = 0; i < 3; i++) {
    edge += carouselGap;
    addKinematic('cylinder', { x: edge + carouselR, y, z: 0 }, { r: carouselR, h: 1 }, i % 2 === 0 ? '#c9527a' : '#4fa9c9', {
      type: 'carousel', speed: 0.8 + i * 0.15, phase: i * 1.3,
    });
    edge += carouselR * 2;
  }
  edge += carouselGap;
  platform(16, 24, '#8a7a63');
  addCheckpoint('cp5', { x: edge - 8, y: y + 1, z: 0 }, 8, '허영의 시장을 벗어나다');

  // =================================================================
  // ZONE G — 죽음의 강 (The River) : 흔들리는 연잎
  // =================================================================
  addStatic('plane_hazard', { x: edge + 45, y: y - 7, z: 0 }, { x: 100, y: 1, z: 28 }, '#2a5a7a');
  const padGap = 6.5, padR = 3;
  edge += 4;
  const lilypads = 8;
  for (let i = 0; i < lilypads; i++) {
    const x = edge + padR;
    const z = Math.sin(i * 1.3) * 4.5;
    addKinematic('cylinder', { x, y, z }, { r: padR, h: 0.8 }, '#3a8a5a', {
      type: 'bob', amplitude: 0.35, speed: 1.6, phase: i * 0.9, axis: 'y',
    });
    edge += padR * 2 + padGap;
  }

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
  // ---------------------------------------------------------------
  function kinematicTransform(piece, t) {
    const m = piece.motion;
    let pos = { x: piece.pos.x, y: piece.pos.y, z: piece.pos.z };
    let angle = { x: 0, y: 0, z: 0 };

    if (m.type === 'bob') {
      pos.y += Math.sin(m.speed * t + m.phase) * m.amplitude;
    } else if (m.type === 'slide') {
      pos[m.axis] += Math.sin(m.speed * t + m.phase) * m.amplitude;
    } else if (m.type === 'pendulum') {
      const ang = Math.sin(m.speed * t + m.phase) * m.amplitude;
      if (m.pivot === 'x') angle.x = ang; else angle.z = ang;
    } else if (m.type === 'rotorY') {
      angle.y = (m.speed * t + m.phase) % (Math.PI * 2);
    } else if (m.type === 'carousel') {
      angle.y = (m.speed * t + m.phase) % (Math.PI * 2);
    }
    return { pos, angle };
  }

  return { spawn, fallY, statics, kinematics, checkpoints, goal, kinematicTransform };
});
