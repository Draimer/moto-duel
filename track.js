// ═══════════════════════════════════════════════════════════════
//  track.js  —  Silverstone GP circuit (simplified classic layout)
//  22 control points · clockwise · flat terrain
//
//  [FIX] computeFrenetFrames 強制鎖定 Y 軸向上，解決扭轉破圖
//  [FIX] getNearestT 局部搜尋快取，避免跳圈
//  [NEW] 賽道方向箭頭 (每 1/18 一個黃色三角)
// ═══════════════════════════════════════════════════════════════

const Track = (() => {

  // ── Silverstone GP — 22 控制點，順時鐘行進 ───────────────────
  // 座標已正規化至 -1…+1，再乘 TRACK_SCALE
  //
  //   右側直線 (Wellington/Pit Straight) → 右上 Copse (右彎)
  //   → 上方 Maggotts / Becketts / Chapel (S 形彎) → Hangar Straight (往左)
  //   → 左側 Stowe (右彎) → Vale (左彎) → Club (緊右彎)
  //   → Woodcote / Luffield → 回主直線
  //
  const RAW_XZ = [
    [  0.62,  0.62 ],  //  0  Start / Finish  (Wellington Straight 底部)
    [  0.62,  0.28 ],  //  1  Wellington Straight
    [  0.62, -0.05 ],  //  2  Straight 末段，接近 Copse
    [  0.50, -0.30 ],  //  3  Copse 入彎 (快速右彎)
    [  0.28, -0.44 ],  //  4  Copse 頂點
    [  0.08, -0.50 ],  //  5  Maggotts 接近段
    [ -0.05, -0.36 ],  //  6  Maggotts (快速左切)
    [  0.08, -0.20 ],  //  7  Becketts S1 (右)
    [ -0.06, -0.04 ],  //  8  Becketts S2 (左)
    [  0.06,  0.13 ],  //  9  Chapel (右)
    [ -0.10,  0.28 ],  // 10  Hangar Straight 起點
    [ -0.40,  0.30 ],  // 11  Hangar Straight 中段
    [ -0.60,  0.28 ],  // 12  Stowe 入彎
    [ -0.68,  0.10 ],  // 13  Stowe 頂點 (右彎)
    [ -0.62, -0.10 ],  // 14  Stowe 出彎
    [ -0.56, -0.32 ],  // 15  Vale 接近段
    [ -0.58, -0.50 ],  // 16  Vale (左彎)
    [ -0.42, -0.62 ],  // 17  Club 入彎
    [ -0.12, -0.65 ],  // 18  Club 頂點 (緊右彎)
    [  0.18, -0.58 ],  // 19  Club 出彎 / Luffield
    [  0.42, -0.38 ],  // 20  Woodcote (快速右彎)
    [  0.60, -0.12 ],  // 21  回主直線入口
  ];

  // Silverstone 地形平坦，不需高低差
  const ELEVATION = new Array(RAW_XZ.length).fill(0);

  const TRACK_SCALE     = 520;
  const ELEVATION_SCALE = 1.0;   // 平坦，此值無影響
  const TRACK_WIDTH     = 12;
  const ROAD_LIFT       = 0.08;
  const TOTAL_LAPS      = 5;
  const BUMP_SEGMENTS   = [27, 28, 29];  // Club 出口路面較顛簸

  const BARRIER_SKIP_RANGES = [];  // 無立交橋，全段都有護欄
  const BARRIER_HEIGHT = 0.55;
  const BARRIER_OFFSET = TRACK_WIDTH + 1.6;

  let trackCurve  = null;
  let checkpoints = [];
  let totalLength = 0;
  let bakedPath   = [];

  // ═══════════════════════════════════════════════════════════════
  //  BUILD
  // ═══════════════════════════════════════════════════════════════
  function build(scene) {
    const ctrlPts = RAW_XZ.map(([x, z], i) =>
      new THREE.Vector3(x * TRACK_SCALE, ELEVATION[i] * ELEVATION_SCALE, z * TRACK_SCALE)
    );

    trackCurve  = new THREE.CatmullRomCurve3(ctrlPts, true, 'catmullrom', 0.5);
    totalLength = trackCurve.getLength();

    // ★ 核心修復：以世界 Y 軸為 up，避免 Frenet Frame 累積扭轉
    trackCurve.computeFrenetFrames = function (segments, closed) {
      const tangents  = new Array(segments + 1);
      const normals   = new Array(segments + 1);
      const binormals = new Array(segments + 1);
      const up = new THREE.Vector3(0, 1, 0);

      let prevBinormal = null;
      for (let i = 0; i <= segments; i++) {
        const u = i / segments;
        const t = this.getTangentAt(u).normalize();
        tangents[i] = t;

        const tHoriz = new THREE.Vector3(t.x, 0, t.z);
        let b;
        if (tHoriz.lengthSq() > 1e-6) {
          tHoriz.normalize();
          b = new THREE.Vector3().crossVectors(tHoriz, up);
          if (b.lengthSq() < 1e-6 && prevBinormal) {
            b.copy(prevBinormal);
          } else {
            b.normalize();
          }
        } else {
          b = prevBinormal ? prevBinormal.clone() : new THREE.Vector3(1, 0, 0);
        }
        binormals[i] = b;
        prevBinormal = b;

        const n = new THREE.Vector3().crossVectors(b, t);
        if (n.lengthSq() > 1e-6) n.normalize();
        else n.copy(up);
        normals[i] = n;
      }

      if (closed) {
        binormals[segments].copy(binormals[0]);
        normals[segments].copy(normals[0]);
        tangents[segments].copy(tangents[0]);
      }
      return { tangents, normals, binormals };
    };

    // 預烘 600 點供 getNearestT 用
    bakedPath = [];
    const BAKED_N = 600;
    for (let i = 0; i <= BAKED_N; i++) {
      bakedPath.push(trackCurve.getPoint(i / BAKED_N));
    }
    bakedPath.N = BAKED_N;

    _buildGround(scene);
    _buildRoadMesh(scene);
    _buildBarriers(scene);
    _buildStartLine(scene);
    _buildGrandstand(scene);
    _buildClubTireWall(scene);
    _buildDirectionArrows(scene);
    _buildTrees(scene);
    _buildCheckpoints();

    return { trackCurve, checkpoints, totalLength, BUMP_SEGMENTS, TRACK_WIDTH };
  }

  // ═══════════════════════════════════════════════════════════════
  //  GROUND
  // ═══════════════════════════════════════════════════════════════
  function _buildGround(scene) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
      new THREE.MeshLambertMaterial({
        color: 0x1e4010,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 2,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.35;
    ground.receiveShadow = true;
    ground.renderOrder  = -20;
    scene.add(ground);
  }

  // ═══════════════════════════════════════════════════════════════
  //  ROAD MESH
  // ═══════════════════════════════════════════════════════════════
  function _buildRoadMesh(scene) {
    const SEG    = 600;
    const pts    = trackCurve.getSpacedPoints(SEG);
    const frames = trackCurve.computeFrenetFrames(SEG, true);

    const pos = [], uvs = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      const b = frames.binormals[i];
      const p = pts[i];
      const L = p.clone().addScaledVector(b, -TRACK_WIDTH);
      const R = p.clone().addScaledVector(b,  TRACK_WIDTH);
      pos.push(L.x, L.y + ROAD_LIFT, L.z,  R.x, R.y + ROAD_LIFT, R.z);
      uvs.push(0, i / SEG * 32,  1, i / SEG * 32);
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, b, c,  b, d, c);
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    roadGeo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
    roadGeo.setIndex(idx);
    roadGeo.computeVertexNormals();

    const roadMesh = new THREE.Mesh(
      roadGeo,
      new THREE.MeshLambertMaterial({
        color: 0x252525,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    roadMesh.receiveShadow = true;
    roadMesh.renderOrder   = 5;
    scene.add(roadMesh);

    _buildCenterLine(scene, pts);
    _buildKerbs(scene, pts, frames, SEG);
  }

  function _buildCenterLine(scene, pts) {
    const pos = [];
    let acc = 0, on = true;
    for (let i = 0; i < pts.length - 1; i++) {
      acc += pts[i].distanceTo(pts[i + 1]);
      if (acc > 9) { acc = 0; on = !on; }
      if (on) pos.push(pts[i].x, pts[i].y + ROAD_LIFT + 0.02, pts[i].z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    scene.add(new THREE.Line(geo,
      new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.45, transparent: true })
    ));
  }

  function _buildKerbs(scene, pts, frames, SEG) {
    const KW  = 1.6;
    const pos = [], col = [], idx = [];

    for (let i = 0; i <= SEG; i++) {
      const b      = frames.binormals[i];
      const p      = pts[i];
      const stripe = Math.floor(i / 5) % 2 === 0;
      const r = 1, g = stripe ? 0 : 1, bv = stripe ? 0 : 1;

      [
        p.clone().addScaledVector(b, -(TRACK_WIDTH + KW)),
        p.clone().addScaledVector(b,  -TRACK_WIDTH),
        p.clone().addScaledVector(b,   TRACK_WIDTH),
        p.clone().addScaledVector(b,   TRACK_WIDTH + KW),
      ].forEach(kp => {
        pos.push(kp.x, kp.y + ROAD_LIFT + 0.02, kp.z);
        col.push(r, g, bv);
      });
    }

    for (let i = 0; i < SEG; i++) {
      const b = i * 4;
      idx.push(b,   b+1, b+4,   b+1, b+5, b+4);
      idx.push(b+2, b+3, b+6,   b+3, b+7, b+6);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const kerbMesh = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    kerbMesh.renderOrder = 6;
    scene.add(kerbMesh);
  }

  // ═══════════════════════════════════════════════════════════════
  //  DIRECTION ARROWS  ← 告訴玩家正確行進方向
  //  每 1/18 圈放一個亮黃色三角箭頭，貼在路面上
  // ═══════════════════════════════════════════════════════════════
  function _buildDirectionArrows(scene) {
    const ARROW_COUNT = 18;
    const ARROW_LEN   = 6.0;    // 前後總長 (m)
    const ARROW_W     = 2.8;    // 半寬 (m)
    const Y_LIFT      = ROAD_LIFT + 0.07;

    const mat = new THREE.MeshBasicMaterial({
      color:       0xFFD700,   // 亮黃
      side:        THREE.DoubleSide,
      transparent: true,
      opacity:     0.88,
      depthWrite:  false,
    });

    for (let i = 0; i < ARROW_COUNT; i++) {
      const t   = i / ARROW_COUNT;
      const p   = trackCurve.getPoint(t);
      const tan = trackCurve.getTangent(t).normalize();

      // 用水平 tangent 計算穩定的左右方向（與 computeFrenetFrames 同邏輯）
      const up     = new THREE.Vector3(0, 1, 0);
      const tHoriz = new THREE.Vector3(tan.x, 0, tan.z).normalize();
      const binorm = new THREE.Vector3().crossVectors(tHoriz, up).normalize();

      // 三角形：尖端在前，底邊在後
      const tip   = p.clone().addScaledVector(tan,   ARROW_LEN * 0.55);
      const baseL = p.clone().addScaledVector(tan,  -ARROW_LEN * 0.45)
                              .addScaledVector(binorm,  ARROW_W);
      const baseR = p.clone().addScaledVector(tan,  -ARROW_LEN * 0.45)
                              .addScaledVector(binorm, -ARROW_W);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([
        tip.x,   Y_LIFT + p.y, tip.z,
        baseL.x, Y_LIFT + p.y, baseL.z,
        baseR.x, Y_LIFT + p.y, baseR.z,
      ], 3));
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 8;
      scene.add(mesh);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  BARRIERS
  // ═══════════════════════════════════════════════════════════════
  function _buildBarriers(scene) {
    const SEG    = 500;
    const pts    = trackCurve.getSpacedPoints(SEG);
    const frames = trackCurve.computeFrenetFrames(SEG, true);
    const WALL_H = BARRIER_HEIGHT;
    const GAP    = BARRIER_OFFSET;
    const mat    = new THREE.MeshLambertMaterial({ color: 0xd8d8d8, side: THREE.FrontSide });

    function isSkippedT(t) {
      return BARRIER_SKIP_RANGES.some(([a, b]) => t >= a && t <= b);
    }

    [-1, 1].forEach(sign => {
      let pos = [], idx = [], vertCount = 0;

      function flushChunk() {
        if (vertCount < 2) { pos = []; idx = []; vertCount = 0; return; }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 7;
        scene.add(mesh);
        pos = []; idx = []; vertCount = 0;
      }

      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        if (isSkippedT(t)) { flushChunk(); continue; }
        const p = pts[i].clone().addScaledVector(frames.binormals[i], sign * GAP);
        pos.push(p.x, p.y + 0.02,          p.z);
        pos.push(p.x, p.y + WALL_H + 0.02, p.z);
        if (vertCount > 0) {
          const a = (vertCount - 1) * 2;
          idx.push(a, a+1, a+2,  a+1, a+3, a+2);
        }
        vertCount++;
      }
      flushChunk();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  START LINE + GANTRY
  // ═══════════════════════════════════════════════════════════════
  function _buildStartLine(scene) {
    const startPt  = trackCurve.getPoint(0);
    const tangent  = trackCurve.getTangent(0);
    const frames   = trackCurve.computeFrenetFrames(1, true);
    const binormal = frames.binormals[0];
    const sqSz     = 1.4;
    const cols     = Math.floor(TRACK_WIDTH * 2 / sqSz);

    for (let c = 0; c < cols; c++) {
      for (let row = 0; row < 3; row++) {
        const black = (c + row) % 2 === 0;
        const sq = new THREE.Mesh(
          new THREE.PlaneGeometry(sqSz, sqSz),
          new THREE.MeshLambertMaterial({ color: black ? 0x111111 : 0xffffff })
        );
        sq.position.copy(startPt)
          .addScaledVector(binormal, (c - cols / 2 + 0.5) * sqSz)
          .addScaledVector(tangent,  (row - 1) * sqSz);
        sq.position.y += 0.06;
        sq.rotation.x  = -Math.PI / 2;
        scene.add(sq);
      }
    }

    // 起跑拱門
    const gMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    [-1, 1].forEach(side => {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), gMat);
      pole.position.copy(startPt).addScaledVector(binormal, side * (TRACK_WIDTH + 1.5));
      pole.position.y = 4.5;
      scene.add(pole);
    });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(TRACK_WIDTH * 2 + 5, 0.6, 0.5), gMat);
    bar.position.copy(startPt);
    bar.position.y = 9;
    scene.add(bar);
  }

  // ═══════════════════════════════════════════════════════════════
  //  GRANDSTAND  — 沿主直線右側
  // ═══════════════════════════════════════════════════════════════
  function _buildGrandstand(scene) {
    const sfX   = 0.62 * TRACK_SCALE + TRACK_WIDTH + 16;
    const sfZ0  = -0.12 * TRACK_SCALE;   // 接近 Copse 端
    const sfZ1  =  0.62 * TRACK_SCALE;   // S/F 端
    const len   = (sfZ1 - sfZ0) * 0.78;
    const centZ = (sfZ0 + sfZ1) / 2;

    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(14, 9, len),
      new THREE.MeshLambertMaterial({ color: 0x888888 })
    );
    stand.position.set(sfX + 7, 4.5, centZ);
    scene.add(stand);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(16, 0.6, len + 6),
      new THREE.MeshLambertMaterial({ color: 0x1a3e88 })   // 銀石藍屋頂
    );
    roof.position.set(sfX + 7, 9.4, centZ);
    scene.add(roof);

    for (let r = 1; r < 5; r++) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(14.1, 0.15, len),
        new THREE.MeshLambertMaterial({ color: 0xdddddd })
      );
      stripe.position.set(sfX + 7, r * 1.8, centZ);
      scene.add(stripe);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  CLUB CORNER TIRE WALL  (銀石最緊的右彎)
  // ═══════════════════════════════════════════════════════════════
  function _buildClubTireWall(scene) {
    const clubCenter = trackCurve.getPoint(18 / RAW_XZ.length);
    const radius     = TRACK_WIDTH + 4.0;
    const mat0       = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const mat1       = new THREE.MeshLambertMaterial({ color: 0xcc1111 });
    const tireGeo    = new THREE.CylinderGeometry(0.65, 0.65, 0.85, 8);

    for (let a = -100; a <= 100; a += 18) {
      const rad  = (a * Math.PI) / 180;
      const tire = new THREE.Mesh(tireGeo, (Math.round(a / 18) % 2 === 0) ? mat0 : mat1);
      tire.position.set(
        clubCenter.x + Math.cos(rad) * radius,
        0.42,
        clubCenter.z + Math.sin(rad) * radius
      );
      tire.rotation.z = Math.PI / 2;
      scene.add(tire);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  TREES
  // ═══════════════════════════════════════════════════════════════
  function _buildTrees(scene) {
    const treeMat  = new THREE.MeshLambertMaterial({ color: 0x2d5a1b });
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
    const SEG    = 100;
    const pts    = trackCurve.getSpacedPoints(SEG);
    const frames = trackCurve.computeFrenetFrames(SEG, true);

    for (let i = 0; i < SEG; i += 4) {
      const b  = frames.binormals[i];
      const p  = pts[i];
      [-1, 1].forEach(side => {
        const off = TRACK_WIDTH + 8 + Math.random() * 14;
        const tp  = p.clone().addScaledVector(b, side * off);
        if (tp.y > 1.5 * ELEVATION_SCALE) return;

        const h     = 3.5 + Math.random() * 4.5;
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.38, h * 0.4, 6), trunkMat
        );
        trunk.position.set(tp.x, h * 0.2, tp.z);
        scene.add(trunk);

        const canopy = new THREE.Mesh(
          new THREE.SphereGeometry(1.3 + Math.random() * 0.9, 6, 5), treeMat
        );
        canopy.position.set(tp.x, h * 0.42 + 1.3, tp.z);
        scene.add(canopy);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  CHECKPOINTS
  // ═══════════════════════════════════════════════════════════════
  function _buildCheckpoints() {
    checkpoints = [];
    for (let i = 0; i < 20; i++) {
      const t = i / 20;
      checkpoints.push({
        t,
        pos:     trackCurve.getPoint(t).clone(),
        tangent: trackCurve.getTangent(t).clone(),
        index:   i,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  UTILS
  // ═══════════════════════════════════════════════════════════════
  function getNearestT(worldPos, hintT) {
    const N = bakedPath.N || 600;

    if (hintT === undefined || hintT === null) {
      let bestT = 0, bestD = Infinity;
      for (let i = 0; i < N; i++) {
        const pt = bakedPath[i];
        const dx = pt.x - worldPos.x;
        const dy = pt.y - worldPos.y;
        const dz = pt.z - worldPos.z;
        const d2 = dx*dx + dy*dy + dz*dz;
        if (d2 < bestD) { bestD = d2; bestT = i / N; }
      }
      return bestT;
    }

    const WINDOW_FRAC = 0.08;
    const span        = Math.ceil(WINDOW_FRAC * N);
    const centerIdx   = Math.round(hintT * N);

    let bestT = hintT, bestD = Infinity;
    for (let o = -span; o <= span; o++) {
      const idx = ((centerIdx + o) % N + N) % N;
      const pt  = bakedPath[idx];
      const dx  = pt.x - worldPos.x;
      const dy  = pt.y - worldPos.y;
      const dz  = pt.z - worldPos.z;
      const d2  = dx*dx + dy*dy + dz*dz;
      if (d2 < bestD) { bestD = d2; bestT = idx / N; }
    }
    return bestT;
  }

  function getTrackYAt(t)     { return trackCurve.getPoint(t).y; }
  function isBumpZone(segIdx) { return BUMP_SEGMENTS.includes(segIdx); }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════
  return {
    build, getNearestT, getTrackYAt, isBumpZone,
    get curve()       { return trackCurve; },
    get checkpoints() { return checkpoints; },
    get width()       { return TRACK_WIDTH; },
    get totalLength() { return totalLength; },
    BUMP_SEGMENTS, TOTAL_LAPS,
  };
})();
