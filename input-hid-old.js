// ═══════════════════════════════════════════════════════════════
//  input.js  —  Dual-player input
//
//  P1 轉向邏輯：
//    滑鼠在螢幕左半部的絕對 X 位置 → 換算成目標方向角偏移
//    滑鼠在中央 = 車頭朝正前方（不轉）
//    滑鼠往左   = 車頭朝左
//    滑鼠往右   = 車頭朝右
//
//  [FIX] 靈敏度大幅降低：MAX_STEER_ANGLE 從 0.72π(130°) 改為 0.18π(32°)
//  [FIX] 速度越高，最大偏轉角越小（高速難轉向，符合物理）
//  [FIX] STEER_TRACK 速度調低，避免角度追蹤過於敏感
// ═══════════════════════════════════════════════════════════════

const Input = (() => {

  const keys     = {};
  const prevKeys = {};

  // 滑鼠絕對位置（0~1，相對各自畫面半邊）
  const mousePos = {
    p1: { x: 0.5, y: 0.5 },
    p2: { x: 0.5, y: 0.5 },
  };

  // P2 鍵盤模擬滑鼠位置
  let p2SimX = 0.5;

  // [FIX] 最大轉向角大幅降低：原本 0.72π(~130°)，現在 0.18π(~32°)
  // 這是滑鼠在最左/右端時的極限偏轉角（相對前進方向）
  const MAX_STEER_ANGLE  = Math.PI * 0.18;

  // [FIX] 車角追蹤速度調低，避免轉向過度靈敏
  const STEER_TRACK_BASE = 6.0;   // 原本 10.0（高速追蹤速度）
  const STEER_TRACK_MIN  = 1.5;   // 原本 3.0（低速追蹤速度）
  const MAX_SPEED_MS     = 90;    // ~324 km/h，速度正規化分母

  // 速度越高，最大偏轉角越小的曲線係數
  // 0 速時 = 100% 偏轉範圍
  // 最高速時 = (1 - SPEED_SENSITIVITY_FALLOFF) = 35% 偏轉範圍
  const SPEED_SENSITIVITY_FALLOFF = 0.65;

  function init() {
    window.addEventListener('keydown', e => {
      keys[e.code] = true;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', e => { keys[e.code] = false; });

    // 追蹤滑鼠絕對位置（不需要 Pointer Lock）
    window.addEventListener('mousemove', e => {
      // P1 在左半畫面，X 位置正規化到 [0, 1]
      const halfW = window.innerWidth / 2;
      mousePos.p1.x = Math.max(0, Math.min(1, e.clientX / halfW));
      mousePos.p1.y = Math.max(0, Math.min(1, e.clientY / window.innerHeight));
    });
  }

  function _edge(code) {
    return !!keys[code] && !prevKeys[code];
  }

  // [FIX] 把滑鼠 X [0,1] 換算成目標方向偏移角
  // normX=0.5 → 0 (直行), normX=0 → -effectiveMax, normX=1 → +effectiveMax
  // speedNorm: 目前速度正規化值 [0,1]，用於縮小高速時的偏轉範圍
  function _mouseToSteerOffset(normX, speedNorm) {
    // 速度越高，最大偏轉角越小
    const speedScale = 1.0 - speedNorm * SPEED_SENSITIVITY_FALLOFF;
    const effectiveMax = MAX_STEER_ANGLE * speedScale;
    return (normX - 0.5) * 2.0 * effectiveMax;
  }

  function read(p1Speed, p2Speed, p1Angle, p2Angle) {
    // 速度正規化（0~1）
    const speedNorm1 = Math.min(1, p1Speed / MAX_SPEED_MS);
    const speedNorm2 = Math.min(1, p2Speed / MAX_SPEED_MS);

    // ── P1 ────────────────────────────────────────────────────
    const p1 = {};
    p1.throttle = keys['KeyW'] ? 1.0 : 0.0;
    p1.brake    = keys['KeyS'] ? 1.0 : 0.0;

    // [FIX] 偏移角根據速度縮小
    const p1Offset = _mouseToSteerOffset(mousePos.p1.x, speedNorm1);
    p1.targetAngleOffset = p1Offset;

    // 給 feedback 用的 tilt 值（保持 -1~1 範圍）
    p1.steer = (mousePos.p1.x - 0.5) * 2.0;

    // [FIX] 轉向追蹤速度（高速更難轉，但基礎值也調低）
    p1.steerTrackSpeed = STEER_TRACK_BASE * (1 - speedNorm1) + STEER_TRACK_MIN * speedNorm1;

    p1.shiftUp   = _edge('KeyE');
    p1.shiftDown = _edge('KeyQ');

    // ── P2 ────────────────────────────────────────────────────
    const p2 = {};
    p2.throttle = keys['ArrowUp']   ? 1.0 : 0.0;
    p2.brake    = keys['ArrowDown'] ? 1.0 : 0.0;

    // 若 WebHID 第二顆實體滑鼠已接上，優先用它
    //  · 它的 virtualX 已經是 [0,1]，直接當 P2 的 mousePos.x
    //  · 並且每幀呼叫 tick() 做可選的回中
    const hidActive = (typeof InputHID !== 'undefined') && InputHID.isActive && InputHID.isActive();
    if (hidActive) {
      InputHID.tick();
      mousePos.p2.x = InputHID.getVirtualX();
      // 保持 p2SimX 與 HID 同步，這樣切回鍵盤時不會瞬間跳
      p2SimX = mousePos.p2.x;
    } else {
      // [FIX] 鍵盤模擬速度略微降低，避免 P2 轉向過快
      if (keys['KeyJ']) p2SimX = Math.max(0, p2SimX - 0.018);  // 原 0.025
      if (keys['KeyL']) p2SimX = Math.min(1, p2SimX + 0.018);
      if (!keys['KeyJ'] && !keys['KeyL']) {
        p2SimX += (0.5 - p2SimX) * 0.08;
      }
      mousePos.p2.x = p2SimX;
    }

    const p2Offset = _mouseToSteerOffset(mousePos.p2.x, speedNorm2);
    p2.targetAngleOffset  = p2Offset;
    p2.steer              = (mousePos.p2.x - 0.5) * 2.0;

    p2.steerTrackSpeed = STEER_TRACK_BASE * (1 - speedNorm2) + STEER_TRACK_MIN * speedNorm2;

    p2.shiftUp   = _edge('KeyP');
    p2.shiftDown = _edge('KeyO');

    // 存 prevKeys
    for (const k in keys) prevKeys[k] = keys[k];

    return { p1, p2 };
  }

  // 硬體升級用：直接注入滑鼠絕對位置
  function injectP1MousePos(normX, normY) {
    mousePos.p1.x = normX;
    mousePos.p1.y = normY;
  }
  function injectP2MousePos(normX, normY) {
    mousePos.p2.x = normX;
    mousePos.p2.y = normY;
  }

  return { init, read, injectP1MousePos, injectP2MousePos };
})();
