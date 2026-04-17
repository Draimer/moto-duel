// ═══════════════════════════════════════════════════════════════
//  feedback.js  —  Haptic / visual feedback dispatcher
//
//  [FIX] _screenShake: 原本目標是 canvas-p1/p2（已被 display:none 隱藏）
//        改為目標 hud-p1/hud-p2 panel，確保畫面震動可見
//        另外增加 game-wrapper 級別的 shake 用於 heavy 碰撞
// ═══════════════════════════════════════════════════════════════

const Feedback = (() => {

  const state = {
    p1: { tilt: 0, rumbleActive: false, bumpActive: false, lastBump: 0 },
    p2: { tilt: 0, rumbleActive: false, bumpActive: false, lastBump: 0 },
  };

  // ── PROCESS BIKE STATE → FEEDBACK EVENTS ──────────────────────
  function process(bikeState1, bikeState2, now) {
    _processPlayer('p1', bikeState1, now);
    _processPlayer('p2', bikeState2, now);
  }

  function _processPlayer(id, bike, now) {
    const fb = state[id];

    // ── Tilt ────────────────────────────────────────────────────
    const newTilt = bike.feedbackTilt;
    if (Math.abs(newTilt - fb.tilt) > 0.05) {
      fb.tilt = newTilt;
      _hardwareTilt(id, newTilt);
    }

    // ── Rumble (off-track / collision) ───────────────────────────
    if (bike.feedbackRumble && !fb.rumbleActive) {
      fb.rumbleActive = true;
      _hardwareRumble(id, 'continuous');
      _screenFlash(id, 'collision');
    } else if (!bike.feedbackRumble && fb.rumbleActive) {
      fb.rumbleActive = false;
      _hardwareRumble(id, 'stop');
    }

    // ── Bump (elevation change) ───────────────────────────────────
    if (bike.feedbackBump && now - fb.lastBump > 600) {
      fb.lastBump = now;
      _hardwareBump(id);
    }
    if (!bike.feedbackBump) fb.bumpActive = false;
  }

  // ── COLLISION EVENT (called externally by main.js) ────────────
  function onCollision(hitPlayerId, severity) {
    _screenFlash(hitPlayerId, 'collision');
    _screenShake(hitPlayerId, severity);
    _hardwareRumble(hitPlayerId, severity === 'heavy' ? 'impact-heavy' : 'impact-medium');

    if (navigator.vibrate) {
      navigator.vibrate(severity === 'heavy' ? [180, 30, 100] : [80, 20, 60]);
    }
  }

  // ── LAP COMPLETE EVENT ────────────────────────────────────────
  function onLapComplete(playerId) {
    if (navigator.vibrate) navigator.vibrate([60, 30, 60, 30, 60]);
    _hardwareRumble(playerId, 'lap');
  }

  // ── VISUAL: SCREEN FLASH ──────────────────────────────────────
  function _screenFlash(playerId, type) {
    const el = document.getElementById(`flash-${playerId}`);
    if (!el) return;
    el.style.opacity = type === 'collision' ? '1' : '0.5';
    setTimeout(() => { el.style.opacity = '0'; }, type === 'collision' ? 120 : 60);
  }

  // ── VISUAL: SCREEN SHAKE ──────────────────────────────────────
  // [FIX] 原本目標 canvas-p1/canvas-p2 被 display:none，震動完全無效
  //       改為：
  //       - heavy 碰撞：震動整個 #game-wrapper（最有感）
  //       - medium 碰撞：震動對應的 HUD 下方面板（hud-p1 / hud-p2）
  function _screenShake(playerId, severity) {
    if (severity === 'heavy') {
      // 整個畫面震動
      const wrapper = document.getElementById('game-wrapper');
      if (!wrapper) return;
      wrapper.classList.remove('shake-heavy', 'shake-light');
      void wrapper.offsetWidth;
      wrapper.classList.add('shake-heavy');
      setTimeout(() => wrapper.classList.remove('shake-heavy'), 400);
    } else {
      // 只震動對應玩家的 HUD 面板
      const panel = document.getElementById(`hud-${playerId}`);
      if (!panel) return;
      panel.classList.remove('shake-heavy', 'shake-light');
      void panel.offsetWidth;
      panel.classList.add('shake-light');
      setTimeout(() => panel.classList.remove('shake-light'), 250);

      // 同時也震動 flash div（視覺衝擊感）
      const flash = document.getElementById(`flash-${playerId}`);
      if (flash) {
        flash.classList.remove('shake-light');
        void flash.offsetWidth;
        flash.classList.add('shake-light');
        setTimeout(() => flash.classList.remove('shake-light'), 250);
      }
    }
  }

  // ── HUD PILL INDICATORS ───────────────────────────────────────
  function getPillStates(playerId) {
    const fb = state[playerId];
    return {
      tiltLeft:  fb.tilt < -0.15,
      tiltRight: fb.tilt >  0.15,
      rumble:    fb.rumbleActive,
      bump:      Date.now() - fb.lastBump < 500,
    };
  }

  function getTilt(playerId) {
    return state[playerId].tilt;
  }

  // ══════════════════════════════════════════════════════════════
  //  HARDWARE STUBS
  // ══════════════════════════════════════════════════════════════

  function _hardwareTilt(playerId, value) {
    const degrees = value * 15;
    console.debug(`[FEEDBACK] ${playerId} TILT → ${degrees.toFixed(1)}°`);
  }

  function _hardwareRumble(playerId, pattern) {
    const patterns = {
      'continuous':    'PWM:80',
      'stop':          'PWM:0',
      'impact-medium': 'BURST:120',
      'impact-heavy':  'BURST:255',
      'lap':           'BURST:60,PAUSE:40,BURST:60',
    };
    console.debug(`[FEEDBACK] ${playerId} RUMBLE → ${pattern}`);
  }

  function _hardwareBump(playerId) {
    console.debug(`[FEEDBACK] ${playerId} BUMP`);
  }

  return {
    process,
    onCollision,
    onLapComplete,
    getPillStates,
    getTilt,
  };
})();
