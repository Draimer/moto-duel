// ═══════════════════════════════════════════════════════════════
//  bike.js  —  Motorcycle physics, gear system, collision
//
//  [UPDATE] 全新高質感賽博風格模型，支援正確的車頭獨立轉向與車輪滾動
//  [FIX] _wrapAngle(): 修正 JS % 運算在負數時行為錯誤的問題
// ═══════════════════════════════════════════════════════════════

const Bike = (() => {

  // ── CONSTANTS ─────────────────────────────────────────────────
  const MAX_GEAR          = 6;
  const GEAR_RATIO        = [0, 0.25, 0.44, 0.62, 0.78, 0.90, 1.0];
  const MAX_SPEED_KMH     = [0, 110,  180,  240,  285,  318,  350];
  const ACCEL_BASE        = 80;
  const BRAKE_FORCE       = 65;
  const STEER_SPEED       = 2.2;
  const DRAG              = 0.008;
  const COLLISION_DIST    = 3.0;
  const COLLISION_PENALTY = 0.45;
  const COLLISION_COOLDOWN= 800;

  function _wrapAngle(a) {
    return ((a % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  }

  // ── BIKE MESH (Cyberpunk / Sportbike Style) ───────────────────
  function createMesh(color) {
    const group = new THREE.Group();

    // -- Materials --
    const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.2 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0.8, roughness: 0.5 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9, roughness: 0.1 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 });
    const neonMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 2.0 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.7, metalness: 1.0, roughness: 0.0 });

    // -- Wheel Generator --
    function makeWheel() {
      const wg = new THREE.Group();
      
      // 輪胎 (軸心設定為 X 軸)
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.12, 16, 32), tireMat);
      tire.rotation.y = Math.PI / 2; 
      wg.add(tire);

      // 輪框
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.18, 24), blackMat);
      rim.rotation.z = Math.PI / 2;
      wg.add(rim);

      // 發光輪幅 (星型)
      for (let i = 0; i < 3; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.56, 0.04), neonMat);
        spoke.rotation.x = (i * Math.PI) / 3;
        wg.add(spoke);
      }

      // 碟煞盤
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.02, 16), chromeMat);
      disc.rotation.z = Math.PI / 2;
      disc.position.x = 0.12;
      wg.add(disc);

      return wg;
    }

    // -- REAR WHEEL --
    const rearSpin = makeWheel();
    const rearWheelGroup = new THREE.Group();
    rearWheelGroup.position.set(0, 0.48, -1.05); // Y=0.48 剛好讓輪胎底部切齊地面
    rearWheelGroup.add(rearSpin);
    group.add(rearWheelGroup);

    // -- FRONT WHEEL & STEERING SYSTEM --
    const frontSteer = new THREE.Group();
    frontSteer.position.set(0, 0.48, 1.15); 

    const frontSpin = makeWheel();
    frontSteer.add(frontSpin);

    // 前叉 (跟著轉向)
    const forkGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.1, 8);
    const forkL = new THREE.Mesh(forkGeo, chromeMat);
    forkL.position.set(-0.18, 0.45, -0.1);
    forkL.rotation.x = -0.25; 
    frontSteer.add(forkL);

    const forkR = forkL.clone();
    forkR.position.x = 0.18;
    frontSteer.add(forkR);

    // 把手
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.65, 8), blackMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 0.9, -0.25);
    frontSteer.add(bar);

    group.add(frontSteer);

    // -- CHASSIS & BODY --
    // 車頭導流罩 (銳利三角錐型)
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.35, 0.8, 4), bodyMat);
    nose.rotation.x = Math.PI / 2;
    nose.rotation.y = Math.PI / 4;
    nose.position.set(0, 0.82, 0.95);
    group.add(nose);

    // 側邊車架與霓虹光條
    const sideBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 1.0), blackMat);
    sideBox.position.set(0, 0.65, 0.2);
    group.add(sideBox);

    const neonStrip = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.9), neonMat);
    neonStrip.position.set(0, 0.65, 0.2);
    group.add(neonStrip);

    // 油箱
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.25, 0.6), bodyMat);
    tank.position.set(0, 0.95, 0.15);
    tank.rotation.x = -0.15;
    group.add(tank);

    // 車尾
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.0, 0.8, 4), bodyMat);
    tail.rotation.x = Math.PI / 2;
    tail.rotation.y = Math.PI / 4;
    tail.position.set(0, 0.98, -0.7);
    group.add(tail);

    // 搖臂
    const swingL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.9), blackMat);
    swingL.position.set(-0.2, 0.48, -0.6);
    swingL.rotation.x = 0.1;
    group.add(swingL);
    const swingR = swingL.clone();
    swingR.position.x = 0.2;
    group.add(swingR);

    // 排氣管
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.8, 8), chromeMat);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(0.28, 0.5, -0.9);
    group.add(exhaust);

    // 擋風玻璃
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.05), glassMat);
    glass.position.set(0, 1.15, 0.7);
    glass.rotation.x = -0.6;
    group.add(glass);

    // 假陰影 (讓車子看起來接地)
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 3.5),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    group.add(shadow);

    // -- RIDER --
    const suitMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5 });

    // 身體 (重度前傾)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.3), suitMat);
    torso.position.set(0, 1.25, -0.2);
    torso.rotation.x = -0.8;
    group.add(torso);

    const backPlate = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.1), armorMat);
    backPlate.position.set(0, 1.3, -0.3);
    backPlate.rotation.x = -0.8;
    group.add(backPlate);

    // 安全帽
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), armorMat);
    helmet.scale.set(1.0, 1.0, 1.2);
    helmet.position.set(0, 1.5, 0.15);
    helmet.rotation.x = -0.2;
    group.add(helmet);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.15, 0.25), glassMat);
    visor.position.set(0, 1.5, 0.25);
    visor.rotation.x = -0.1;
    group.add(visor);

    // 手臂
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), suitMat);
    armL.position.set(-0.28, 1.15, 0.1);
    armL.rotation.x = -1.1;
    group.add(armL);
    const armR = armL.clone();
    armR.position.x = 0.28;
    group.add(armR);

    // 腿部
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), suitMat);
    legL.position.set(-0.25, 0.8, -0.35);
    legL.rotation.x = -0.5;
    group.add(legL);
    const legR = legL.clone();
    legR.position.x = 0.25;
    group.add(legR);

    // 儲存參照以供 update() 操作
    group.userData.frontSteer = frontSteer;
    group.userData.frontSpin = frontSpin;
    group.userData.rearSpin = rearSpin;

    // 啟用陰影
    group.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    return group;
  }

  // ── BIKE STATE ────────────────────────────────────────────────
  function createState(startPos, startAngle, playerId) {
    return {
      id: playerId,
      position:  startPos.clone(),
      angle:     startAngle,
      baseAngle: startAngle,
      leanAngle: 0,
      velocityX: 0,
      velocityZ: 0,
      speed:     0,
      gear:      1,
      rpm:       0,
      throttle:  0,
      brake:     0,
      steerAngle:0,
      lap:            1,
      trackT:         0,
      prevTrackT:     0,
      totalProgress:  0,      // ★ 累積有號進度 (1.0 = 一圈)，唯一的圈數權威
      lastCheckpoint:-1,
      passedStart:    false,
      lapStartTime:   0,
      lapTimes:       [],
      bestLap:        Infinity,
      finished:      false,
      finishTime:    0,
      lastCollision: 0,
      feedbackTilt:  0,
      feedbackRumble:false,
      feedbackRumbleTtl: 0,
      feedbackBump:  false,
      offTrackTimer: 0,
      lastProgressDelta: 0,
      wrongWayTime: 0,
    };
  }

  // ── PHYSICS UPDATE ────────────────────────────────────────────
  function update(state, dt, trackData) {
    if (state.finished) return;

    const { trackCurve: curve, TRACK_WIDTH: width, BUMP_SEGMENTS } = trackData;

    // ── 絕對方向轉向 ──────────────────────────────────────────
    const baseFollow = 2.0;   
    const angleDiff  = state.angle - state.baseAngle;
    const wrappedDiff = _wrapAngle(angleDiff);
    state.baseAngle  += wrappedDiff * Math.min(1, dt * baseFollow);

    const targetAngle = state.baseAngle + (state.targetAngleOffset || 0);

    const trackSpeed = state.steerTrackSpeed || 3.0;
    const diff       = targetAngle - state.angle;
    const wDiff      = _wrapAngle(diff);
    state.angle     += wDiff * Math.min(1, dt * trackSpeed);

    const steerInput = Math.max(-1, Math.min(1, (state.targetAngleOffset || 0) / (Math.PI * 0.18)));

    // Acceleration
    const gearAccel  = ACCEL_BASE * GEAR_RATIO[state.gear];
    const maxSpeedMs = MAX_SPEED_KMH[state.gear] / 3.6;

    if (state.throttle > 0.05) {
      state.speed += state.throttle * gearAccel * dt;
    } else {
      state.speed -= state.speed * 0.35 * dt;
    }
    if (state.brake > 0.05) {
      state.speed -= state.brake * BRAKE_FORCE * dt;
    }

    state.speed -= state.speed * state.speed * DRAG * dt;
    state.speed  = Math.max(0, Math.min(maxSpeedMs * 1.05, state.speed));

    // Move
    state.position.x += Math.sin(state.angle) * state.speed * dt;
    state.position.z += Math.cos(state.angle) * state.speed * dt;

    // Elevation  ─ 用上一幀的 trackT 當提示，避免鄰近路段時跳到錯的 T
    const nearT  = Track.getNearestT(state.position, state.trackT);
    const trackY = Track.getTrackYAt(nearT);
    state.position.y += (trackY - state.position.y) * Math.min(1, dt * 12);
    state.trackT = nearT;

    // Bump
    const segIdx = Math.floor(nearT * 35);
    state.feedbackBump = Track.isBumpZone(segIdx % 35);

    // RPM
    const gearLow  = MAX_SPEED_KMH[Math.max(1, state.gear - 1)] / 3.6;
    const gearHigh = maxSpeedMs;
    state.rpm = gearHigh > gearLow
      ? Math.min(1, (state.speed - gearLow) / (gearHigh - gearLow) + state.throttle * 0.12)
      : state.throttle * 0.9;
    state.rpm = Math.max(0.05, state.rpm);

    // Lean
    const targetLean = -steerInput * 0.45 * Math.min(1, state.speed / 14);
    state.leanAngle += (targetLean - state.leanAngle) * Math.min(1, dt * 9);
    state.feedbackTilt = -steerInput * Math.min(1, state.speed / 14);

    // Track boundary
    const trackCenter = curve.getPoint(nearT);
    const dx = state.position.x - trackCenter.x;
    const dz = state.position.z - trackCenter.z;
    const distFromCenter = Math.sqrt(dx * dx + dz * dz);

    state.offTrackTimer = distFromCenter > width * 1.04
      ? state.offTrackTimer + dt
      : Math.max(0, state.offTrackTimer - dt * 1.6);

    if (distFromCenter > width * 1.1) {
      const pf = (distFromCenter - width * 1.1) / width;
      state.position.x -= (dx / distFromCenter) * pf * 3.0;
      state.position.z -= (dz / distFromCenter) * pf * 3.0;
      state.speed *= 0.86;

      // ── 撞牆角度修正：防止 baseAngle 繼續追著牆壁方向 ──────────
      // 計算車頭是否確實朝牆壁推（dot > 0 = 衝向牆）
      const wallNx   = dx / distFromCenter;
      const wallNz   = dz / distFromCenter;
      const intoWall = Math.sin(state.angle) * wallNx + Math.cos(state.angle) * wallNz;
      if (intoWall > 0.1) {
        // 取賽道切線角（最近的順向 or 逆向），65% 強度平滑修正
        const tan       = curve.getTangent(nearT);
        const trackFwd  = Math.atan2(tan.x, tan.z);
        const toCW      = _wrapAngle(trackFwd           - state.angle);
        const toCCW     = _wrapAngle(trackFwd + Math.PI - state.angle);
        const snapAngle = Math.abs(toCW) <= Math.abs(toCCW) ? trackFwd : (trackFwd + Math.PI);
        state.angle    += _wrapAngle(snapAngle - state.angle) * 0.65;
        state.baseAngle = state.angle;   // 同步 baseAngle，切斷錯誤的追蹤迴圈
      }

      state.feedbackRumble = true;
      state.feedbackRumbleTtl = 0;
    } else {
      if (state.feedbackRumbleTtl > 0) {
        state.feedbackRumbleTtl -= dt * 1000;
        state.feedbackRumble = true;   
      } else {
        state.feedbackRumble = false;
      }
    }

    // ── MESH UPDATE (視覺與動畫更新) ──────────────────────────────
    if (state.mesh) {
      state.mesh.position.copy(state.position);
      state.mesh.rotation.y = state.angle;
      state.mesh.rotation.z = state.leanAngle;

      const spin = state.speed * dt * 2.8;

      // 1. 車頭轉向獨立計算 (Y軸)，受 steerAngle (-1到1) 控制
      if (state.mesh.userData.frontSteer) {
        state.mesh.userData.frontSteer.rotation.y = state.steerAngle * -0.6;
      }
      
      // 2. 輪胎滾動獨立計算 (X軸)
      if (state.mesh.userData.frontSpin) {
        state.mesh.userData.frontSpin.rotation.x -= spin; 
      }
      if (state.mesh.userData.rearSpin) {
        state.mesh.userData.rearSpin.rotation.x -= spin;
      }
    }
  }

  // ── COLLISION ─────────────────────────────────────────────────
  function checkCollision(stateA, stateB, now) {
    if (stateA.finished || stateB.finished) return null;
    if (now - stateA.lastCollision < COLLISION_COOLDOWN) return null;
    if (now - stateB.lastCollision < COLLISION_COOLDOWN) return null;

    const dx   = stateA.position.x - stateB.position.x;
    const dz   = stateA.position.z - stateB.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < COLLISION_DIST) {
      if (stateA.speed >= stateB.speed) {
        stateB.speed                *= COLLISION_PENALTY;
        stateB.feedbackRumble        = true;
        stateB.feedbackRumbleTtl     = 350;
        stateA.lastCollision         = stateB.lastCollision = now;
        return 'b';
      } else {
        stateA.speed                *= COLLISION_PENALTY;
        stateA.feedbackRumble        = true;
        stateA.feedbackRumbleTtl     = 350;
        stateA.lastCollision         = stateB.lastCollision = now;
        return 'a';
      }
    }
    return null;
  }

  // ── GEAR ──────────────────────────────────────────────────────
  function shiftUp(state)   { if (state.gear < MAX_GEAR) { state.gear++; return true; } return false; }
  function shiftDown(state) { if (state.gear > 1)        { state.gear--; return true; } return false; }

  // ── LAP ───────────────────────────────────────────────────────
  // ★ 完全改寫：改用「有號進度累積」代替「checkpoint 觸發」。
  //   原本的邏輯在完成一圈後會把 lastCheckpoint 重置為 -1，但 passedStart 仍為 true，
  //   下一幀車子還在 T≈0 附近時會再次命中 checkpoint 0 → 再加一圈，
  //   連續幾幀就能把 5 圈全部跑完。這就是「比賽瞬間結束」的根因。
  //
  //   新做法：每幀把 wrap-corrected 的 ΔT 累加到 totalProgress。
  //   1.0 的累積進度 = 一圈。只要局部搜尋保證 trackT 連續、單調，
  //   無論 Frenet 是否扭轉、車輛是否在起跑線附近抖動，
  //   進度都無法被灌水，圈數永遠正確。
  function updateLap(state, checkpoints, now) {
    const currentT = state.trackT;

    // 計算有號的單幀進度 (處理環形 wrap)
    let delta = currentT - state.prevTrackT;
    if (delta >  0.5) delta -= 1;   // 後退時的 wrap (0.02 → 0.98)
    if (delta < -0.5) delta += 1;   // 前進時的 wrap (0.98 → 0.02)

    // 物理防護：單幀變化不可能超過幾個百分點，超過就視為噪音 (例如 spawn 的第一幀)
    if (Math.abs(delta) > 0.15) delta = 0;

    state.lastProgressDelta = delta;
    state.totalProgress += delta;
    state.prevTrackT     = currentT;

    // 第一次越過起跑線 → 啟動計時
    if (!state.passedStart && state.totalProgress > 0.005) {
      state.passedStart  = true;
      state.lapStartTime = now;
    }

    // 圈數 = floor(totalProgress) + 1 (從 Lap 1 開始)
    const newLap = Math.max(1, Math.floor(state.totalProgress) + 1);

    if (newLap > state.lap && state.passedStart) {
      const lapTime = now - state.lapStartTime;
      state.lapTimes.push(lapTime);
      if (lapTime < state.bestLap) state.bestLap = lapTime;
      state.lap          = newLap;
      state.lapStartTime = now;
      return { type: 'lap', lapTime, lap: newLap - 1 };
    }

    return null;
  }

  return {
    createMesh, createState, update,
    checkCollision, shiftUp, shiftDown, updateLap,
    MAX_GEAR, MAX_SPEED_KMH, COLLISION_DIST,
  };
})();
