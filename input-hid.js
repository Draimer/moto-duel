// ═══════════════════════════════════════════════════════════════
//  input-hid.js  —  Local bridge input for two independent mice
// ═══════════════════════════════════════════════════════════════

const InputBridge = (() => {
  let ws = null;
  let isConnecting = false;
  let pendingDevicesResolver = null;
  let pendingDevicesRejecter = null;

  const WS_URL = 'ws://127.0.0.1:8765';

  const players = {
    p1: {
      active: false,
      deviceId: null,
      productName: null,
      virtualX: 0.5,
      sensitivity: 1 / 150, // 提高靈敏度
      recenterPerFrame: 0,
    },
    p2: {
      active: false,
      deviceId: null,
      productName: null,
      virtualX: 0.5,
      sensitivity: 1 / 150, // 提高靈敏度
      recenterPerFrame: 0,
    },
  };

  function supported() {
    return typeof WebSocket !== 'undefined';
  }

  function isActive(playerId) {
    const p = players[playerId];
    return !!(p && p.active);
  }

  function getVirtualX(playerId) {
    const p = players[playerId];
    if (!p) return 0.5;
    return p.virtualX;
  }

  function setSensitivity(playerId, value) {
    const p = players[playerId];
    if (!p) return;
    if (Number.isFinite(value) && value > 0) {
      p.sensitivity = value;
    }
  }

  function setRecenter(playerId, value) {
    const p = players[playerId];
    if (!p) return;
    if (Number.isFinite(value) && value >= 0 && value <= 1) {
      p.recenterPerFrame = value;
    }
  }

  function resetVirtualX(playerId) {
    const p = players[playerId];
    if (!p) return;
    p.virtualX = 0.5;
  }

  function tick() {
    for (const id of ['p1', 'p2']) {
      const p = players[id];
      if (!p) continue;
      if (p.recenterPerFrame > 0) {
        p.virtualX += (0.5 - p.virtualX) * p.recenterPerFrame;
        if (p.virtualX < 0) p.virtualX = 0;
        if (p.virtualX > 1) p.virtualX = 1;
      }
    }
  }

  async function ensureConnected() {
    if (!supported()) {
      throw new Error('瀏覽器不支援 WebSocket。');
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (isConnecting) {
      await waitForSocketReady();
      return;
    }

    isConnecting = true;

    ws = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        isConnecting = false;
        reject(new Error('連不到本機橋接程式，請先啟動 MouseBridge。'));
      }, 3000);

      ws.onopen = () => {
        clearTimeout(timer);
        isConnecting = false;
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timer);
        isConnecting = false;
        reject(new Error('WebSocket 連線失敗。'));
      };

      ws.onclose = () => {
        for (const id of ['p1', 'p2']) {
          players[id].active = false;
          players[id].deviceId = null;
          players[id].productName = null;
          players[id].virtualX = 0.5;
        }
      };

      ws.onmessage = onMessage;
    });
  }

  function waitForSocketReady() {
    return new Promise((resolve, reject) => {
      const start = performance.now();

      const t = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          clearInterval(t);
          resolve();
          return;
        }
        if (performance.now() - start > 3000) {
          clearInterval(t);
          reject(new Error('等待橋接連線逾時。'));
        }
      }, 50);
    });
  }

  function onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (msg.type === 'devices') {
      if (pendingDevicesResolver) {
        pendingDevicesResolver(Array.isArray(msg.devices) ? msg.devices : []);
        pendingDevicesResolver = null;
        pendingDevicesRejecter = null;
      }
      return;
    }

    if (msg.type === 'move') {
      const playerId = msg.playerId;
      const p = players[playerId];
      if (!p) return;

      const dx = Number(msg.dx) || 0;
      // console.log('MOVE', playerId, dx); // 測試完可把這行註解掉避免 Console 太吵

      p.virtualX += dx * p.sensitivity;

      if (p.virtualX < 0) p.virtualX = 0;
      if (p.virtualX > 1) p.virtualX = 1;
      return;
    }

    if (msg.type === 'connected') {
      const playerId = msg.playerId;
      const p = players[playerId];
      if (!p) return;

      p.active = true;
      if (msg.deviceId) p.deviceId = msg.deviceId;
      if (msg.name) p.productName = msg.name;
      return;
    }

    if (msg.type === 'disconnected') {
      const playerId = msg.playerId;
      const p = players[playerId];
      if (!p) return;

      p.active = false;
      p.deviceId = null;
      p.productName = null;
      p.virtualX = 0.5;
      return;
    }

    if (msg.type === 'error') {
      console.error('[InputBridge]', msg.message || 'bridge error');
    }
  }

  function requestDevices() {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('橋接程式尚未連線。'));
        return;
      }

      pendingDevicesResolver = resolve;
      pendingDevicesRejecter = reject;

      ws.send(JSON.stringify({ type: 'list-devices' }));

      setTimeout(() => {
        if (pendingDevicesRejecter) {
          pendingDevicesRejecter(new Error('拿不到裝置清單。'));
          pendingDevicesResolver = null;
          pendingDevicesRejecter = null;
        }
      }, 2000);
    });
  }

  async function bindPlayer(playerId) {
    if (!players[playerId]) {
      throw new Error(`未知 playerId: ${playerId}`);
    }

    await ensureConnected();

    const devices = await requestDevices();
    if (!devices.length) {
      throw new Error('橋接程式有啟動，但沒有回傳任何裝置。');
    }

    const options = devices
      .map((d, i) => {
        const name = d.name || d.productName || `(裝置 ${i + 1})`;
        return `${i + 1}. ${name}`;
      })
      .join('\n');

    const defaultPick = playerId === 'p1' ? '1' : '2';
    const raw = prompt(`請輸入要綁定給 ${playerId.toUpperCase()} 的滑鼠編號：\n\n${options}`, defaultPick);
    
    if (raw === null) return; // 使用者按取消
    
    const idx = Number(raw) - 1;

    if (!Number.isInteger(idx) || idx < 0 || idx >= devices.length) {
      throw new Error('未選擇有效裝置。');
    }

    const device = devices[idx];
    const deviceId = device.id || device.deviceId || `device-${idx}`;
    const name = device.name || device.productName || `Mouse ${idx + 1}`;

    players[playerId].deviceId = deviceId;
    players[playerId].productName = name;
    players[playerId].virtualX = 0.5;
    players[playerId].active = true;

    ws.send(JSON.stringify({
      type: 'bind-device',
      playerId,
      deviceId,
    }));

    return {
      playerId,
      deviceId,
      productName: name,
      vendorId: 0,
      productId: 0,
    };
  }

  async function unbindPlayer(playerId) {
    if (!players[playerId]) return;

    players[playerId].active = false;
    players[playerId].deviceId = null;
    players[playerId].productName = null;
    players[playerId].virtualX = 0.5;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'unbind-device',
        playerId,
      }));
    }
  }

  async function disconnectAll() {
    await unbindPlayer('p1');
    await unbindPlayer('p2');

    if (ws) {
      try { ws.close(); } catch (_) {}
      ws = null;
    }
  }

  function getStatus() {
    return {
      connected: !!(ws && ws.readyState === WebSocket.OPEN),
      p1: { ...players.p1 },
      p2: { ...players.p2 },
    };
  }

  return {
    supported,
    isActive,
    getVirtualX,
    setSensitivity,
    setRecenter,
    resetVirtualX,
    tick,
    ensureConnected,
    requestDevices,
    bindPlayer,
    unbindPlayer,
    disconnectAll,
    getStatus,
  };
})();

// ──────────────────────────────────────────────────────────────
// 相容舊版按鈕 / 舊程式碼用的 InputHID 殼
// ──────────────────────────────────────────────────────────────
const InputHID = (() => {
  function supported() {
    return InputBridge.supported();
  }

  function isActive() {
    return InputBridge.isActive('p2');
  }

  function getVirtualX() {
    return InputBridge.getVirtualX('p2');
  }

  function setSensitivity(v) {
    InputBridge.setSensitivity('p2', v);
  }

  function setRecenter(v) {
    InputBridge.setRecenter('p2', v);
  }

  function resetVirtualX() {
    InputBridge.resetVirtualX('p2');
  }

  function tick() {
    InputBridge.tick();
  }

  async function connect() {
    return await InputBridge.bindPlayer('p2');
  }

  async function disconnect() {
    return await InputBridge.unbindPlayer('p2');
  }

  return {
    supported,
    isActive,
    getVirtualX,
    setSensitivity,
    setRecenter,
    resetVirtualX,
    tick,
    connect,
    disconnect,
  };
})();

// ★★★ 核心防禦：強制掛載到 Window 全域物件，讓 input.js 絕對抓得到 ★★★
window.InputBridge = InputBridge;
window.InputHID = InputHID;