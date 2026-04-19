const InputBridge = (() => {
  let ws = null;
  let isConnecting = false;
  let connectPromise = null;
  let pendingDevicesRequest = null;
  let pendingDevicesRequestId = 0;
  let currentBindPromise = null;
  const pendingBindRequests = new Map();
  const bridgeDebug = {
    p1: null,
    p2: null,
  };

  const WS_URL = 'ws://127.0.0.1:8765';
  const AXIS_LOCK_RATIO = 1.35;
  const AXIS_NOISE_FLOOR = 1;

  const players = {
    p1: {
      active: false,
      deviceId: null,
      productName: null,
      axis: 0,
      sensitivity: 1 / 75,
    },
    p2: {
      active: false,
      deviceId: null,
      productName: null,
      axis: 0,
      sensitivity: 1 / 75,
    },
  };

  function _clampAxis(v) {
    if (!Number.isFinite(v)) return 0;
    if (v < -1) return -1;
    if (v > 1) return 1;
    return v;
  }

  function supported() {
    return typeof WebSocket !== 'undefined';
  }

  function resetPlayers() {
    for (const id of ['p1', 'p2']) {
      players[id].active = false;
      players[id].deviceId = null;
      players[id].productName = null;
      players[id].axis = 0;
    }
  }

  function failPendingDevices(error) {
    if (!pendingDevicesRequest) return;
    const pending = pendingDevicesRequest;
    clearTimeout(pending.timer);
    pendingDevicesRequest = null;
    pending.reject(error);
  }

  function failPendingBinds(error) {
    for (const pending of pendingBindRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    pendingBindRequests.clear();
  }

  function isActive(playerId) {
    const player = players[playerId];
    return !!(player && player.active);
  }

  function getAxis(playerId) {
    const player = players[playerId];
    if (!player) return 0;
    return player.axis;
  }

  function getVirtualX(playerId) {
    return 0.5 + getAxis(playerId) * 0.5;
  }

  function setSensitivity(playerId, value) {
    const player = players[playerId];
    if (!player) return;
    if (Number.isFinite(value) && value > 0) {
      player.sensitivity = value;
    }
  }

  function setRecenter(playerId, value) {
    void playerId;
    void value;
  }

  function resetVirtualX(playerId) {
    const player = players[playerId];
    if (!player) return;
    player.axis = 0;
  }

  function tick() {}

  async function ensureConnected() {
    if (!supported()) {
      throw new Error('WebSocket is not supported in this browser.');
    }

    if (ws && ws.readyState === WebSocket.OPEN) return;

    if (isConnecting && connectPromise) {
      await connectPromise;
      return;
    }

    isConnecting = true;
    ws = new WebSocket(WS_URL);

    connectPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        isConnecting = false;
        connectPromise = null;
        reject(new Error('MouseBridge connection timed out.'));
      }, 3000);

      ws.onopen = () => {
        clearTimeout(timer);
        isConnecting = false;
        connectPromise = null;
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timer);
        isConnecting = false;
        connectPromise = null;
        failPendingDevices(new Error('MouseBridge WebSocket failed.'));
        failPendingBinds(new Error('MouseBridge WebSocket failed.'));
        reject(new Error('MouseBridge WebSocket failed.'));
      };

      ws.onclose = () => {
        resetPlayers();
        failPendingDevices(new Error('MouseBridge connection closed.'));
        failPendingBinds(new Error('MouseBridge connection closed.'));
      };

      ws.onmessage = onMessage;
    });

    await connectPromise;
  }

  function onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (msg.type === 'devices') {
      if (pendingDevicesRequest && (msg.requestId == null || msg.requestId === pendingDevicesRequest.requestId)) {
        const pending = pendingDevicesRequest;
        clearTimeout(pending.timer);
        pendingDevicesRequest = null;
        pending.resolve(Array.isArray(msg.devices) ? msg.devices : []);
      }
      return;
    }

    if (msg.type === 'move') {
      const player = players[msg.playerId];
      if (!player) return;

      const dx = Number(msg.dx) || 0;
      const dy = Number(msg.dy) || 0;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx <= AXIS_NOISE_FLOOR && absDy <= AXIS_NOISE_FLOOR) return;
      if (absDy > absDx * AXIS_LOCK_RATIO) return;

      player.axis = _clampAxis(player.axis + dx * player.sensitivity);
      return;
    }

    if (msg.type === 'connected') {
      const player = players[msg.playerId];
      if (!player) return;

      player.active = true;
      if (msg.deviceId) player.deviceId = msg.deviceId;
      if (msg.name) player.productName = msg.name;

      const pendingBind = pendingBindRequests.get(msg.playerId);
      if (pendingBind) {
        clearTimeout(pendingBind.timer);
        pendingBindRequests.delete(msg.playerId);
        pendingBind.resolve({
          playerId: msg.playerId,
          deviceId: player.deviceId,
          productName: player.productName,
          vendorId: 0,
          productId: 0,
        });
      }
      return;
    }

    if (msg.type === 'disconnected') {
      const player = players[msg.playerId];
      if (!player) return;

      player.active = false;
      player.deviceId = null;
      player.productName = null;
      player.axis = 0;

      const pendingBind = pendingBindRequests.get(msg.playerId);
      if (pendingBind) {
        clearTimeout(pendingBind.timer);
        pendingBindRequests.delete(msg.playerId);
        pendingBind.reject(new Error(`MouseBridge rejected ${msg.playerId.toUpperCase()} binding.`));
      }
      return;
    }

    if (msg.type === 'error') {
      failPendingBinds(new Error(msg.message || 'bridge error'));
      console.error('[InputBridge]', msg.message || 'bridge error');
      return;
    }

    if (msg.type === 'bridge-debug') {
      if (msg.playerId === 'p1' || msg.playerId === 'p2') {
        bridgeDebug[msg.playerId] = {
          rawInputRegistered: !!msg.rawInputRegistered,
          rawInputRegisterError: Number(msg.rawInputRegisterError) || 0,
          boundDeviceId: msg.boundDeviceId || '',
          boundDeviceName: msg.boundDeviceName || '',
          boundHandle: msg.boundHandle || '',
          lastRawHandle: msg.lastRawHandle || '',
          lastRawDx: Number(msg.lastRawDx) || 0,
          lastRawDy: Number(msg.lastRawDy) || 0,
          rawInputCount: Number(msg.rawInputCount) || 0,
          moveSentCount: Number(msg.moveSentCount) || 0,
          lastMoveDx: Number(msg.lastMoveDx) || 0,
          lastMoveDy: Number(msg.lastMoveDy) || 0,
        };
      }
    }
  }

  function requestDevices() {
    if (pendingDevicesRequest) {
      return pendingDevicesRequest.promise;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('MouseBridge is not connected.'));
    }

    const requestId = ++pendingDevicesRequestId;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingDevicesRequest && pendingDevicesRequest.requestId === requestId) {
          pendingDevicesRequest = null;
          reject(new Error('Timed out while listing devices.'));
        }
      }, 4000);

      pendingDevicesRequest = { requestId, resolve, reject, timer, promise: null };

      ws.send(JSON.stringify({
        type: 'list-devices',
        requestId,
      }));
    });

    pendingDevicesRequest.promise = promise;
    return promise;
  }

  async function selectDevice(message, defaultPick) {
    if (typeof window.__motoDuelSelectOption === 'function') {
      return window.__motoDuelSelectOption(message, defaultPick);
    }
    return prompt(message, defaultPick);
  }

  function waitForBindAck(playerId) {
    const existing = pendingBindRequests.get(playerId);
    if (existing) {
      return existing.promise;
    }

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingBindRequests.delete(playerId);
        reject(new Error(`Timed out while waiting for ${playerId.toUpperCase()} bind confirmation.`));
      }, 4000);

      pendingBindRequests.set(playerId, { resolve, reject, timer, promise: null });
    });

    pendingBindRequests.get(playerId).promise = promise;
    return promise;
  }

  async function bindPlayer(playerId) {
    if (!players[playerId]) {
      throw new Error(`Unknown playerId: ${playerId}`);
    }

    if (currentBindPromise) {
      return currentBindPromise;
    }

    currentBindPromise = (async () => {
      await ensureConnected();

      const devices = await requestDevices();
      if (!devices.length) {
        throw new Error('No mouse devices were reported by MouseBridge.');
      }

      const options = devices
        .map((device, index) => {
          const name = device.name || device.productName || `(Device ${index + 1})`;
          return `${index + 1}. ${name}`;
        })
        .join('\n');

      const defaultPick = playerId === 'p1' ? '1' : '2';
      const raw = await selectDevice(`Select a mouse for ${playerId.toUpperCase()}:\n\n${options}`, defaultPick);
      if (raw === null) return;

      const index = Number(raw) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= devices.length) {
        throw new Error('Invalid mouse selection.');
      }

      const device = devices[index];
      const deviceId = device.id || device.deviceId || `device-${index}`;
      const name = device.name || device.productName || `Mouse ${index + 1}`;

      players[playerId].active = false;
      players[playerId].deviceId = null;
      players[playerId].productName = null;
      players[playerId].axis = 0;

      const bindAck = waitForBindAck(playerId);
      ws.send(JSON.stringify({
        type: 'bind-device',
        playerId,
        deviceId,
      }));

      const boundInfo = await bindAck;
      return {
        ...boundInfo,
        productName: boundInfo.productName || name,
      };
    })();

    try {
      return await currentBindPromise;
    } finally {
      currentBindPromise = null;
    }
  }

  async function unbindPlayer(playerId) {
    if (!players[playerId]) return;

    players[playerId].active = false;
    players[playerId].deviceId = null;
    players[playerId].productName = null;
    players[playerId].axis = 0;

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

    failPendingDevices(new Error('MouseBridge was disconnected.'));
    failPendingBinds(new Error('MouseBridge was disconnected.'));
  }

  function getStatus() {
    return {
      connected: !!(ws && ws.readyState === WebSocket.OPEN),
      p1: { ...players.p1, virtualX: getVirtualX('p1') },
      p2: { ...players.p2, virtualX: getVirtualX('p2') },
      debug: {
        p1: bridgeDebug.p1 ? { ...bridgeDebug.p1 } : null,
        p2: bridgeDebug.p2 ? { ...bridgeDebug.p2 } : null,
      },
    };
  }

  return {
    supported,
    isActive,
    getAxis,
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

  function getAxis() {
    return InputBridge.getAxis('p2');
  }

  function setSensitivity(value) {
    InputBridge.setSensitivity('p2', value);
  }

  function setRecenter(value) {
    InputBridge.setRecenter('p2', value);
  }

  function resetVirtualX() {
    InputBridge.resetVirtualX('p2');
  }

  function tick() {
    InputBridge.tick();
  }

  async function connect() {
    return InputBridge.bindPlayer('p2');
  }

  async function disconnect() {
    return InputBridge.unbindPlayer('p2');
  }

  return {
    supported,
    isActive,
    getVirtualX,
    getAxis,
    setSensitivity,
    setRecenter,
    resetVirtualX,
    tick,
    connect,
    disconnect,
  };
})();

window.InputBridge = InputBridge;
window.InputHID = InputHID;
