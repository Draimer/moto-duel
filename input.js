const Input = (() => {
  const keys = {};
  const prevKeys = {};

  const MAX_STEER_ANGLE        = Math.PI * 0.30;
  const STEER_TRACK_BASE       = 9.0;
  const STEER_TRACK_MIN        = 3.0;
  const MAX_SPEED_MS           = 90;
  const SPEED_SENSITIVITY_FALLOFF = 0.35;

  // ── Pointer Lock 滑鼠（P1，bridge 未連線時）──────────────────
  // 進入遊戲自動鎖定游標，用 movementX 相對位移累積虛擬 X
  let mouseVirtualX    = 0.5;   // 0 = 最左, 1 = 最右
  let mouseActive      = false; // pointer lock 是否已鎖定
  const MOUSE_SENSITIVITY = 1 / 350;  // 每 px 的轉向量（越大越靈敏）
  const MOUSE_RECENTER    = 0.05;     // 靜止時每幀回正力道

  // ── P2 鍵盤轉向（J/L，bridge 未連線時）──────────────────────
  let p2KeySteerX      = 0.5;
  const P2_KEY_SPEED   = 0.05;
  const P2_KEY_RECENTER = 0.08;

  // ── 請求 Pointer Lock（需從使用者事件呼叫）──────────────────
  function requestPointerLock() {
    const el = document.getElementById('game-wrapper') || document.body;
    try { el.requestPointerLock(); } catch (_) {}
  }

  function init() {
    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      keys[e.code] = false;
    });

    // Pointer Lock 狀態監聽
    document.addEventListener('pointerlockchange', () => {
      const el = document.getElementById('game-wrapper') || document.body;
      mouseActive = document.pointerLockElement === el;
      if (mouseActive) mouseVirtualX = 0.5; // 鎖定瞬間重置回直行
    });

    // 追蹤相對位移（pointer lock 生效時才更新）
    document.addEventListener('mousemove', (e) => {
      if (!mouseActive) return;
      mouseVirtualX += e.movementX * MOUSE_SENSITIVITY;
      if (mouseVirtualX < 0) mouseVirtualX = 0;
      if (mouseVirtualX > 1) mouseVirtualX = 1;
    });

    // 點擊畫面時自動鎖定（e.g. 點到遊戲區域但 lock 已解除）
    const wrapper = document.getElementById('game-wrapper');
    if (wrapper) {
      wrapper.addEventListener('click', () => {
        if (!mouseActive) requestPointerLock();
      });
    }
  }

  function _edge(code) {
    return !!keys[code] && !prevKeys[code];
  }

  function _clamp01(v) {
    if (!Number.isFinite(v)) return 0.5;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  function _bridgeTick() {
    try { window.InputBridge?.tick?.(); } catch (_) {}
  }

  function _bridgeActive(playerId) {
    try { return !!window.InputBridge?.isActive?.(playerId); } catch (_) { return false; }
  }

  function _bridgeGetX(playerId) {
    try { return _clamp01(window.InputBridge?.getVirtualX?.(playerId)); } catch (_) { return 0.5; }
  }

  function _mouseToSteerOffset(normX, speedNorm) {
    const speedScale  = 1.0 - speedNorm * SPEED_SENSITIVITY_FALLOFF;
    const effectiveMax = MAX_STEER_ANGLE * speedScale;
    return (normX - 0.5) * 2.0 * effectiveMax;
  }

  function _makeBasePlayer(speedNorm, throttle, brake, shiftUp, shiftDown) {
    return {
      throttle,
      brake,
      targetAngleOffset: 0,
      steer: 0,
      steerTrackSpeed: STEER_TRACK_BASE * (1 - speedNorm) + STEER_TRACK_MIN * speedNorm,
      shiftUp,
      shiftDown,
      reset: false,
    };
  }

  function read(p1Speed, p2Speed, p1Angle, p2Angle) {
    _bridgeTick();

    const speedNorm1 = Math.min(1, p1Speed / MAX_SPEED_MS);
    const speedNorm2 = Math.min(1, p2Speed / MAX_SPEED_MS);

    // P1：方向鍵上/下 油門/煞車，左/右 降/升檔
    const p1 = _makeBasePlayer(
      speedNorm1,
      keys['ArrowUp']   ? 1.0 : 0.0,
      keys['ArrowDown'] ? 1.0 : 0.0,
      _edge('ArrowRight'),
      _edge('ArrowLeft')
    );

    // P2：W/S 油門/煞車，D/A 升/降檔
    const p2 = _makeBasePlayer(
      speedNorm2,
      keys['KeyW'] ? 1.0 : 0.0,
      keys['KeyS'] ? 1.0 : 0.0,
      _edge('KeyD'),
      _edge('KeyA')
    );

    // P1：Pointer Lock 滑鼠每幀自動回正（靜止時車頭漸漸回直）
    if (!_bridgeActive('p1') && mouseActive) {
      mouseVirtualX += (0.5 - mouseVirtualX) * MOUSE_RECENTER;
    }

    // P2：鍵盤 J/L 累積，bridge 未連線時生效
    if (!_bridgeActive('p2')) {
      if      (keys['KeyJ']) p2KeySteerX = Math.max(0, p2KeySteerX - P2_KEY_SPEED);
      else if (keys['KeyL']) p2KeySteerX = Math.min(1, p2KeySteerX + P2_KEY_SPEED);
      else                   p2KeySteerX += (0.5 - p2KeySteerX) * P2_KEY_RECENTER;
    }

    const p1x = _bridgeActive('p1') ? _bridgeGetX('p1') : mouseVirtualX;
    const p2x = _bridgeActive('p2') ? _bridgeGetX('p2') : p2KeySteerX;

    p1.targetAngleOffset = _mouseToSteerOffset(p1x, speedNorm1);
    p1.steer             = (p1x - 0.5) * 2.0;

    p2.targetAngleOffset = _mouseToSteerOffset(p2x, speedNorm2);
    p2.steer             = (p2x - 0.5) * 2.0;
    p1.reset             = _edge('KeyR');
    p2.reset             = _edge('KeyU');

    for (const k in keys) prevKeys[k] = keys[k];

    return { p1, p2 };
  }

  return { init, read, requestPointerLock };
})();
