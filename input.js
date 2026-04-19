const Input = (() => {
  const keys = {};
  const prevKeys = {};

  const MAX_STEER_ANGLE = Math.PI * 0.30;
  const STEER_TRACK_BASE = 9.0;
  const STEER_TRACK_MIN = 3.0;
  const MAX_SPEED_MS = 90;
  const SPEED_SENSITIVITY_FALLOFF = 0.35;
  const STEER_DEADZONE = 0.04;

  let mouseAxis = 0;
  let mouseActive = false;
  const DEFAULT_MOUSE_SENSITIVITY = 1 / 340;
  let mouseSensitivity = DEFAULT_MOUSE_SENSITIVITY;

  function requestPointerLock() {
    const el = document.getElementById('game-wrapper') || document.body;
    try {
      const maybePromise = el.requestPointerLock();
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
      }
    } catch (_) {}
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

    document.addEventListener('pointerlockchange', () => {
      const el = document.getElementById('game-wrapper') || document.body;
      mouseActive = document.pointerLockElement === el;
      if (mouseActive) {
        mouseAxis = 0;
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!mouseActive) return;
      // Positive movementX should mean "turn right".
      mouseAxis = _clampAxis(mouseAxis + e.movementX * mouseSensitivity * 2);
    });

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

  function _clampAxis(v) {
    if (!Number.isFinite(v)) return 0;
    if (v < -1) return -1;
    if (v > 1) return 1;
    return v;
  }

  function _bridgeTick() {
    try {
      window.InputBridge?.tick?.();
    } catch (_) {}
  }

  function _bridgeActive(playerId) {
    try {
      return !!window.InputBridge?.isActive?.(playerId);
    } catch (_) {
      return false;
    }
  }

  function _bridgeAxis(playerId) {
    try {
      return _clampAxis(window.InputBridge?.getAxis?.(playerId));
    } catch (_) {
      return 0;
    }
  }

  function _applyDeadzone(axis) {
    const amount = Math.abs(axis);
    if (amount <= STEER_DEADZONE) return 0;
    const scaled = (amount - STEER_DEADZONE) / (1 - STEER_DEADZONE);
    return Math.sign(axis) * scaled;
  }

  function _axisToAngleOffset(axis, speedNorm) {
    const steerInput = _applyDeadzone(axis);
    const speedScale = 1.0 - speedNorm * SPEED_SENSITIVITY_FALLOFF;
    const effectiveMax = MAX_STEER_ANGLE * speedScale;
    return steerInput * effectiveMax;
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

  function _readPlayerAxis(playerId) {
    if (_bridgeActive(playerId)) {
      return {
        source: 'bridge',
        active: true,
        axis: _bridgeAxis(playerId),
      };
    }

    if (playerId === 'p1') {
      return {
        source: 'mouse',
        active: mouseActive,
        axis: mouseAxis,
      };
    }

    return {
      source: 'idle',
      active: false,
      axis: 0,
    };
  }

  function read(p1Speed, p2Speed) {
    _bridgeTick();

    const speedNorm1 = Math.min(1, p1Speed / MAX_SPEED_MS);
    const speedNorm2 = Math.min(1, p2Speed / MAX_SPEED_MS);

    const p1 = _makeBasePlayer(
      speedNorm1,
      keys['ArrowUp'] ? 1.0 : 0.0,
      keys['ArrowDown'] ? 1.0 : 0.0,
      _edge('ArrowRight'),
      _edge('ArrowLeft')
    );

    const p2 = _makeBasePlayer(
      speedNorm2,
      keys['KeyW'] ? 1.0 : 0.0,
      keys['KeyS'] ? 1.0 : 0.0,
      _edge('KeyD'),
      _edge('KeyA')
    );

    const p1Input = _readPlayerAxis('p1');
    const p2Input = _readPlayerAxis('p2');

    p1.steer = _applyDeadzone(p1Input.axis);
    p1.targetAngleOffset = _axisToAngleOffset(p1Input.axis, speedNorm1);

    p2.steer = _applyDeadzone(p2Input.axis);
    p2.targetAngleOffset = _axisToAngleOffset(p2Input.axis, speedNorm2);

    p1.reset = _edge('KeyR');
    p2.reset = _edge('KeyU');

    for (const k in keys) prevKeys[k] = keys[k];

    return { p1, p2 };
  }

  function setMouseSensitivity(value) {
    if (!Number.isFinite(value)) return;
    mouseSensitivity = Math.max(1 / 520, Math.min(1 / 120, value));
  }

  function getMouseSensitivity() {
    return mouseSensitivity;
  }

  function getDebugState() {
    const p1Input = _readPlayerAxis('p1');
    const p2Input = _readPlayerAxis('p2');

    return {
      mouseActive,
      mouseAxis,
      mouseVirtualX: 0.5 + mouseAxis * 0.5,
      mouseSensitivity,
      p1: {
        source: p1Input.source,
        active: p1Input.active,
        axis: p1Input.axis,
        x: 0.5 + p1Input.axis * 0.5,
        steer: _applyDeadzone(p1Input.axis),
        targetAngleOffset: _axisToAngleOffset(p1Input.axis, 0),
      },
      p2: {
        source: p2Input.source,
        active: p2Input.active,
        axis: p2Input.axis,
        x: 0.5 + p2Input.axis * 0.5,
        steer: _applyDeadzone(p2Input.axis),
        targetAngleOffset: _axisToAngleOffset(p2Input.axis, 0),
      },
    };
  }

  return { init, read, requestPointerLock, setMouseSensitivity, getMouseSensitivity, getDebugState };
})();
