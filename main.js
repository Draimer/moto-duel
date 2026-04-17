// ═══════════════════════════════════════════════════════════════
//  main.js  —  Game loop, scene init, renderer, game states
// ═══════════════════════════════════════════════════════════════

let gamePhase = 'menu';   // 'menu' | 'countdown' | 'racing' | 'paused' | 'finished'
let lastTime  = 0;
let scene, renderer;
let trackData;
let bikeState1, bikeState2;
let bike1Mesh,  bike2Mesh;
let phaseBeforePause = 'racing';

const settings = {
  autoResetEnabled: true,
  wrongWayResetMs: 3600,
  stuckResetMs: 2600,
};

// ── SCENE INIT ────────────────────────────────────────────────
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 120, 600);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff5e0, 1.1);
  sun.position.set(80, 160, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near   =   1;
  sun.shadow.camera.far    = 800;
  sun.shadow.camera.left   = -300;
  sun.shadow.camera.right  =  300;
  sun.shadow.camera.top    =  300;
  sun.shadow.camera.bottom = -300;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xaaccff, 0.3);
  fill.position.set(-60, 40, -80);
  scene.add(fill);

  renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.setSize(window.innerWidth, window.innerHeight);

  document.getElementById('canvas-p1').style.display = 'none';
  document.getElementById('canvas-p2').style.display = 'none';
  const rCanvas = renderer.domElement;
  rCanvas.style.position = 'absolute';
  rCanvas.style.inset    = '0';
  rCanvas.style.zIndex   = '1';
  document.getElementById('game-wrapper').appendChild(rCanvas);

  trackData = Track.build(scene);
  CameraSystem.init(window.innerWidth, window.innerHeight);
  Input.init();
  HUD.init(trackData.trackCurve);
  bindUiEvents();

  window.addEventListener('resize', onResize);
  requestAnimationFrame(loop);
}

// ── SPAWN BIKES ───────────────────────────────────────────────
function spawnBikes() {
  if (bike1Mesh) scene.remove(bike1Mesh);
  if (bike2Mesh) scene.remove(bike2Mesh);

  const spline     = trackData.trackCurve;
  const startPt    = spline.getPoint(0.0);
  const startTan   = spline.getTangent(0.0);
  const frames     = spline.computeFrenetFrames(1, true);
  const binormal   = frames.binormals[0];
  // 目前賽道參數方向與預期起跑方向相反，起跑朝向需反轉 180°
  const startAngle = Math.atan2(-startTan.x, -startTan.z);

  const p1Pos = startPt.clone().addScaledVector(binormal, -2.5).add(new THREE.Vector3(0, 0.5, 0));
  const p2Pos = startPt.clone().addScaledVector(binormal,  2.5).add(new THREE.Vector3(0, 0.5, 0));

  bikeState1 = Bike.createState(p1Pos, startAngle, 'p1');
  bikeState2 = Bike.createState(p2Pos, startAngle, 'p2');

  bike1Mesh = Bike.createMesh(0x00CFFF);
  bike2Mesh = Bike.createMesh(0xFF4444);

  bikeState1.mesh = bike1Mesh;
  bikeState2.mesh = bike2Mesh;

  bike1Mesh.position.copy(p1Pos);
  bike2Mesh.position.copy(p2Pos);
  bike1Mesh.rotation.y = startAngle;
  bike2Mesh.rotation.y = startAngle;

  scene.add(bike1Mesh);
  scene.add(bike2Mesh);
}

// ── START GAME ────────────────────────────────────────────────
function startGame() {
  document.getElementById('overlay').style.display = 'none';
  hidePauseMenu();
  closeSettingsPanel();
  spawnBikes();
  gamePhase = 'countdown';
  runCountdown();
  Input.requestPointerLock(); // 自動鎖定游標，啟用 FPS 式滑鼠輸入
}

// ── COUNTDOWN — pure setTimeout, zero CSS dependency ──────────
function runCountdown() {
  const el  = document.getElementById('countdown');
  const num = document.getElementById('countdown-num');
  el.style.display = 'flex';

  const steps = ['3','2','1','GO!'];
  let i = 0;

  function next() {
    if (i >= steps.length) {
      el.style.display = 'none';
      gamePhase = 'racing';
      const t = performance.now();
      bikeState1.lapStartTime = t;
      bikeState2.lapStartTime = t;
      lastTime = t;
      return;
    }
    num.textContent = steps[i];
    num.style.color = steps[i] === 'GO!' ? '#00E676' : '#ffffff';
    i++;
    setTimeout(next, 850);
  }
  next();
}

// ── MAIN LOOP ─────────────────────────────────────────────────
function loop(now) {
  requestAnimationFrame(loop);

  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (gamePhase === 'racing' && bikeState1 && bikeState2) {
    updateGame(dt, now);
  } else if (gamePhase === 'countdown' && bikeState1) {
    CameraSystem.update(bikeState1, bikeState2 || bikeState1, dt);
  }

  renderFrame();
}

// ── UPDATE ────────────────────────────────────────────────────
function updateGame(dt, now) {
  const { p1: inp1, p2: inp2 } = Input.read(bikeState1.speed, bikeState2.speed, bikeState1.angle, bikeState2.angle);

  bikeState1.throttle          = inp1.throttle;
  bikeState1.brake             = inp1.brake;
  bikeState1.steerAngle        = inp1.steer;
  bikeState1.targetAngleOffset = inp1.targetAngleOffset;
  bikeState1.steerTrackSpeed   = inp1.steerTrackSpeed;

  bikeState2.throttle          = inp2.throttle;
  bikeState2.brake             = inp2.brake;
  bikeState2.steerAngle        = inp2.steer;
  bikeState2.targetAngleOffset = inp2.targetAngleOffset;
  bikeState2.steerTrackSpeed   = inp2.steerTrackSpeed;

  if (inp1.shiftUp)   Bike.shiftUp(bikeState1);
  if (inp1.shiftDown) Bike.shiftDown(bikeState1);
  if (inp2.shiftUp)   Bike.shiftUp(bikeState2);
  if (inp2.shiftDown) Bike.shiftDown(bikeState2);
  if (inp1.reset) resetBikeToTrack(bikeState1, -2.5, 'P1 手動重置');
  if (inp2.reset) resetBikeToTrack(bikeState2,  2.5, 'P2 手動重置');

  Bike.update(bikeState1, dt, trackData);
  Bike.update(bikeState2, dt, trackData);

  const hit = Bike.checkCollision(bikeState1, bikeState2, now);
  if (hit === 'b') Feedback.onCollision('p2', 'medium');
  if (hit === 'a') Feedback.onCollision('p1', 'medium');

  const ev1 = Bike.updateLap(bikeState1, trackData.checkpoints, now);
  const ev2 = Bike.updateLap(bikeState2, trackData.checkpoints, now);

  processWrongWayAndResets(bikeState1, dt, -2.5, 'P1');
  processWrongWayAndResets(bikeState2, dt,  2.5, 'P2');

  if (ev1 && ev1.type === 'lap') {
    const isBest = bikeState1.lapTimes.at(-1) === bikeState1.bestLap;
    HUD.showLapNotif('p1', ev1.lap, ev1.lapTime, isBest);
    Feedback.onLapComplete('p1');
    checkRaceEnd();
  }
  if (ev2 && ev2.type === 'lap') {
    const isBest = bikeState2.lapTimes.at(-1) === bikeState2.bestLap;
    HUD.showLapNotif('p2', ev2.lap, ev2.lapTime, isBest);
    Feedback.onLapComplete('p2');
    checkRaceEnd();
  }

  CameraSystem.update(bikeState1, bikeState2, dt);
  Feedback.process(bikeState1, bikeState2, now);
  HUD.update(bikeState1, bikeState2, now);
}

// ── RACE END ──────────────────────────────────────────────────
function checkRaceEnd() {
  if (gamePhase !== 'racing') return;
  const done1 = bikeState1.lap > Track.TOTAL_LAPS;
  const done2 = bikeState2.lap > Track.TOTAL_LAPS;
  if (done1 || done2) {
    gamePhase = 'finished';
    setTimeout(() => HUD.showWinner(done1 ? 'p1' : 'p2', bikeState1, bikeState2), 2000);
  }
}

// ── RESTART ───────────────────────────────────────────────────
function restartGame() {
  bikeState1 = bikeState2 = null;
  document.getElementById('screen-win').style.display   = 'none';
  document.getElementById('screen-start').style.display = 'block';
  document.getElementById('overlay').style.display      = 'flex';
  hidePauseMenu();
  closeSettingsPanel();
  gamePhase = 'menu';
}

function processWrongWayAndResets(state, dt, laneOffset, label) {
  const movingWrongWay = state.lastProgressDelta < -0.0009 && state.speed > 6;
  if (movingWrongWay) {
    state.wrongWayTime += dt * 1000;
  } else {
    state.wrongWayTime = Math.max(0, state.wrongWayTime - dt * 700);
  }

  if (!settings.autoResetEnabled) return;

  if (state.wrongWayTime > settings.wrongWayResetMs) {
    resetBikeToTrack(state, laneOffset, `${label} 逆向過久，自動重置`);
    return;
  }

  const isStuckOnWall = state.offTrackTimer * 1000 > settings.stuckResetMs && state.speed < 9;
  if (isStuckOnWall) {
    resetBikeToTrack(state, laneOffset, `${label} 卡牆，自動重置`);
  }
}

function resetBikeToTrack(state, laneOffset, reason) {
  if (!state || !trackData?.trackCurve) return;

  const t = Track.getNearestT(state.position, state.trackT);
  const center = trackData.trackCurve.getPoint(t);
  const tangent = trackData.trackCurve.getTangent(t).normalize();
  const right = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
  const trackY = Track.getTrackYAt(t);
  
  // 重置朝向需與起跑一致（避免重置後反向）
  const angle = Math.atan2(-tangent.x, -tangent.z);

  state.position.copy(center).addScaledVector(right, laneOffset);
  state.position.y = trackY + 0.5;
  state.angle = angle;
  state.baseAngle = angle;
  state.leanAngle = 0;
  state.speed = 0;
  state.throttle = 0;
  state.brake = 0;
  state.velocityX = 0;
  state.velocityZ = 0;
  state.feedbackRumble = false;
  state.feedbackRumbleTtl = 0;
  state.offTrackTimer = 0;
  state.wrongWayTime = 0;

  if (state.mesh) {
    state.mesh.position.copy(state.position);
    state.mesh.rotation.set(0, angle, 0);
  }
  HUD.showSystemMessage(reason);
}

function bindUiEvents() {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (gamePhase === 'racing' || gamePhase === 'countdown') {
        setPause(true);
      } else if (gamePhase === 'paused') {
        resumeGame();
      }
    }
  });

  document.getElementById('btn-resume')?.addEventListener('click', resumeGame);
  document.getElementById('btn-open-settings')?.addEventListener('click', () => openSettingsPanel(true));
  document.getElementById('btn-exit-menu')?.addEventListener('click', () => {
    setPause(false);
    restartGame();
  });
  document.getElementById('settings-close')?.addEventListener('click', closeSettingsPanel);
  document.getElementById('opt-auto-reset')?.addEventListener('change', (e) => {
    settings.autoResetEnabled = !!e.target.checked;
  });
  document.getElementById('opt-wrongway')?.addEventListener('input', (e) => {
    settings.wrongWayResetMs = Number(e.target.value) * 1000;
    document.getElementById('opt-wrongway-val').textContent = `${e.target.value}s`;
  });
  document.getElementById('opt-stuck')?.addEventListener('input', (e) => {
    settings.stuckResetMs = Number(e.target.value) * 1000;
    document.getElementById('opt-stuck-val').textContent = `${e.target.value}s`;
  });
}

function setPause(forcePause) {
  if (forcePause) {
    if (!['racing', 'countdown'].includes(gamePhase)) return;
    phaseBeforePause = gamePhase;
    gamePhase = 'paused';
    document.exitPointerLock?.();
    showPauseMenu();
    return;
  }

  if (gamePhase === 'paused') {
    hidePauseMenu();
  }
}

function resumeGame() {
  if (gamePhase !== 'paused') return;
  hidePauseMenu();
  closeSettingsPanel();
  gamePhase = phaseBeforePause === 'countdown' ? 'countdown' : 'racing';
  lastTime = performance.now();
  Input.requestPointerLock();
}

function showPauseMenu() {
  const panel = document.getElementById('pause-menu');
  if (panel) panel.style.display = 'flex';
}

function hidePauseMenu() {
  const panel = document.getElementById('pause-menu');
  if (panel) panel.style.display = 'none';
}

function openSettingsPanel(fromPause = false) {
  const panel = document.getElementById('settings-panel');
  if (panel) panel.style.display = 'flex';
  if (fromPause) showPauseMenu();
}

function closeSettingsPanel() {
  const panel = document.getElementById('settings-panel');
  if (panel) panel.style.display = 'none';
}

// ── RENDER ────────────────────────────────────────────────────
function renderFrame() {
  if (!renderer) return;
  const W    = window.innerWidth;
  const H    = window.innerHeight;
  const half = Math.floor(W / 2);

  renderer.setScissorTest(true);

  renderer.clear(true, true, true);

  renderer.setViewport(0, 0, half, H);
  renderer.setScissor(0, 0, half, H);
  renderer.clearDepth();
  renderer.render(scene, CameraSystem.getCam1());

  renderer.setViewport(half, 0, W - half, H);
  renderer.setScissor(half, 0, W - half, H);
  renderer.clearDepth();
  renderer.render(scene, CameraSystem.getCam2());

  renderer.setScissorTest(false);
}

// ── RESIZE ────────────────────────────────────────────────────
function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  CameraSystem.resize(window.innerWidth, window.innerHeight);
}

// ── BOOT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', initScene);