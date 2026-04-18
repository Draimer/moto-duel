// ═══════════════════════════════════════════════════════════════
//  track.js  —  Monza-inspired circuit (high-speed + chicanes)
//  30 control points · clockwise · flat terrain
//
//  [FIX] computeFrenetFrames 強制鎖定 Y 軸向上，解決扭轉破圖
//  [FIX] getNearestT 局部搜尋快取，避免跳圈
//  [NEW] 賽道方向箭頭 (每 1/18 一個黃色三角)
// ═══════════════════════════════════════════════════════════════

const Track = (() => {

  // ── Monza 風格賽道 — 30 控制點，順時鐘行進 ───────────────────
  // 座標已正規化至 -1…+1，再乘 TRACK_SCALE
  //
  //   主直線 → Variante del Rettifilo (T1/T2 減速彎)
  //   → Curva Grande 長弧 → Variante della Roggia
  //   → Lesmo 1 / Lesmo 2 → Serraglio 直線
  //   → Ascari 複合彎 → Parabolica 長右彎回主直線
  //
  const RAW_XZ = [
    [  0.54,  0.62 ],  //  0  Start / Finish
    [  0.56,  0.35 ],  //  1  主直線
    [  0.57,  0.02 ],  //  2  主直線中段
    [  0.58, -0.34 ],  //  3  主直線末端高速
    [  0.56, -0.62 ],  //  4  T1 煞車點
    [  0.42, -0.70 ],  //  5  Rettifilo 右切
    [  0.22, -0.62 ],  //  6  Rettifilo 左切
    [  0.30, -0.48 ],  //  7  Chicane 出口
    [  0.18, -0.36 ],  //  8  Curva Grande 入
    [ -0.02, -0.24 ],  //  9  Curva Grande 中
    [ -0.26, -0.20 ],  // 10  Curva Grande 後段
    [ -0.50, -0.28 ],  // 11  Roggia 接近
    [ -0.72, -0.42 ],  // 12  Roggia 右切
    [ -0.60, -0.54 ],  // 13  Roggia 左切
    [ -0.42, -0.46 ],  // 14  Roggia 出口
    [ -0.28, -0.35 ],  // 15  Lesmo 1 進彎
    [ -0.16, -0.24 ],  // 16  Lesmo 1 出口
    [ -0.26, -0.10 ],  // 17  Lesmo 2 入彎
    [ -0.42,  0.06 ],  // 18  Lesmo 2 出彎
    [ -0.40,  0.24 ],  // 19  Serraglio 起點
    [ -0.20,  0.36 ],  // 20  Serraglio 中段
    [  0.06,  0.34 ],  // 21  Serraglio 末端
    [  0.28,  0.22 ],  // 22  Ascari 煞車點
    [  0.40,  0.08 ],  // 23  Ascari 右
    [  0.48, -0.06 ],  // 24  Ascari 左
    [  0.34, -0.18 ],  // 25  Ascari 右出口
    [  0.16, -0.08 ],  // 26  Parabolica 入彎
    [  0.04,  0.10 ],  // 27  Parabolica 內側
    [  0.08,  0.34 ],  // 28  Parabolica 持續給油
    [  0.30,  0.56 ],  // 29  Parabolica 出彎接主直線
  ];

  // Monza 風格同樣以平地為主，不做高低差
  const ELEVATION = new Array(RAW_XZ.length).fill(0);

  const TRACK_SCALE     = 520;
  const ELEVATION_SCALE = 1.0;   // 平坦，此值無影響
  const TRACK_WIDTH     = 12;
  const ROAD_LIFT       = 0.08;
  const ROAD_DECAL_LIFT = ROAD_LIFT + 0.03;
  const TOTAL_LAPS      = 5;
  const BUMP_SEGMENTS   = [11, 12, 13, 24];  // Chicane 區域顛簸感較強

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
    _buildPitComplex(scene);
    _buildRunoffApron(scene);
    _buildSponsorBoards(scene);
    _buildMarshalTowers(scene);
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
        side: THREE.FrontSide,
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
      if (on) pos.push(pts[i].x, pts[i].y + ROAD_DECAL_LIFT, pts[i].z);
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
        pos.push(kp.x, kp.y + ROAD_DECAL_LIFT, kp.z);
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
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -1,
      })
    );
    kerbMesh.renderOrder = 6;
    scene.add(kerbMesh);
  }

  // ── RUNOFF APRON (修復賽道邊緣破圖 / 補強視覺過渡) ───────────
  function _buildRunoffApron(scene) {
    const SEG = 600;
    const SHOULDER_IN = TRACK_WIDTH + 1.6;
    const SHOULDER_OUT = TRACK_WIDTH + 6.8;
    const pts = trackCurve.getSpacedPoints(SEG);
    const frames = trackCurve.computeFrenetFrames(SEG, true);
    const pos = [], idx = [];

    for (let i = 0; i <= SEG; i++) {
      const p = pts[i];
      const b = frames.binormals[i];
      const li = p.clone().addScaledVector(b, -SHOULDER_IN);
      const lo = p.clone().addScaledVector(b, -SHOULDER_OUT);
      const ri = p.clone().addScaledVector(b,  SHOULDER_IN);
      const ro = p.clone().addScaledVector(b,  SHOULDER_OUT);
      pos.push(
        lo.x, lo.y + ROAD_LIFT - 0.01, lo.z,
        li.x, li.y + ROAD_LIFT - 0.01, li.z,
        ri.x, ri.y + ROAD_LIFT - 0.01, ri.z,
        ro.x, ro.y + ROAD_LIFT - 0.01, ro.z
      );
    }

    for (let i = 0; i < SEG; i++) {
      const b = i * 4;
      idx.push(b, b + 1, b + 4, b + 1, b + 5, b + 4);
      idx.push(b + 2, b + 3, b + 6, b + 3, b + 7, b + 6);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({
        color: 0x303030,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      })
    );
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    scene.add(mesh);
  }

  // ═══════════════════════════════════════════════════════════════
  //  DIRECTION ARROWS  ← 告訴玩家正確行進方向
  //  每 1/18 圈放一個亮黃色三角箭頭，貼在路面上
  // ═══════════════════════════════════════════════════════════════
  function _buildDirectionArrows(scene) {
    const ARROW_COUNT = 18;
    const ARROW_LEN   = 6.0;    // 前後總長 (m)
    const ARROW_W     = 2.8;    // 半寬 (m)
    const Y_LIFT      = ROAD_DECAL_LIFT + 0.03;

    const mat = new THREE.MeshBasicMaterial({
      color:       0xFFD700,   // 亮黃
      side:        THREE.DoubleSide,
      transparent: true,
      opacity:     0.88,
      depthWrite:  false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });

    for (let i = 0; i < ARROW_COUNT; i++) {
      const t   = i / ARROW_COUNT;
      const p   = trackCurve.getPoint(t);
      const tan = getForwardTangent(t);

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
      const pos = [];
      const idx = [];

      for (let i = 0; i < SEG; i++) {
        const p = pts[i].clone().addScaledVector(frames.binormals[i], sign * GAP);
        pos.push(p.x, p.y + 0.02, p.z);
        pos.push(p.x, p.y + WALL_H + 0.02, p.z);
      }

      for (let i = 0; i < SEG; i++) {
        const tA = i / SEG;
        const tB = ((i + 1) % SEG) / SEG;
        if (isSkippedT(tA) || isSkippedT(tB)) continue;

        const a = i * 2;
        const b = i * 2 + 1;
        const c = ((i + 1) % SEG) * 2;
        const d = ((i + 1) % SEG) * 2 + 1;
        idx.push(a, b, c,  b, d, c);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 7;
      scene.add(mesh);
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
        sq.position.y += ROAD_DECAL_LIFT;
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
  //  PIT COMPLEX (主直線維修區)
  // ═══════════════════════════════════════════════════════════════
  function _buildPitComplex(scene) {
    const baseX = 0.62 * TRACK_SCALE - TRACK_WIDTH - 20;
    const z0 = -0.06 * TRACK_SCALE;
    const z1 = 0.56 * TRACK_SCALE;
    const len = z1 - z0;
    const centerZ = (z0 + z1) / 2;

    const pitMain = new THREE.Mesh(
      new THREE.BoxGeometry(22, 8, len),
      new THREE.MeshLambertMaterial({ color: 0x6f7278 })
    );
    pitMain.position.set(baseX - 10, 4, centerZ);
    scene.add(pitMain);

    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(22.4, 2.5, len - 6),
      new THREE.MeshLambertMaterial({ color: 0x5d758c })
    );
    glass.position.set(baseX - 10, 7.2, centerZ);
    scene.add(glass);

    const pitWall = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 1.5, len + 8),
      new THREE.MeshLambertMaterial({ color: 0xc9c9c9 })
    );
    pitWall.position.set(baseX + 1.5, 0.75, centerZ);
    scene.add(pitWall);

    const garageMat = new THREE.MeshLambertMaterial({ color: 0x404449 });
    const garageCount = 18;
    for (let i = 0; i < garageCount; i++) {
      const z = z0 + (i + 0.5) * (len / garageCount);
      const bay = new THREE.Mesh(new THREE.BoxGeometry(6.5, 3.2, 2.2), garageMat);
      bay.position.set(baseX + 0.5, 1.6, z);
      scene.add(bay);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SPONSOR BOARDS
  // ═══════════════════════════════════════════════════════════════
  function _buildSponsorBoards(scene) {
    const SEG = 120;
    const pts = trackCurve.getSpacedPoints(SEG);
    const frames = trackCurve.computeFrenetFrames(SEG, true);
    const matA = new THREE.MeshLambertMaterial({ color: 0x0f4aa8 });
    const matB = new THREE.MeshLambertMaterial({ color: 0xc81f27 });
    const matC = new THREE.MeshLambertMaterial({ color: 0x1c1c1c });

    for (let i = 0; i < SEG; i += 6) {
      if ((i > 20 && i < 30) || (i > 90 && i < 100)) continue;
      const p = pts[i];
      const b = frames.binormals[i];
      const t = trackCurve.getTangent(i / SEG).normalize();
      const side = (i % 12 === 0) ? -1 : 1;
      const pos = p.clone().addScaledVector(b, side * (TRACK_WIDTH + 10));
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(7.5, 2.4, 0.5),
        (i % 18 === 0) ? matA : (i % 18 === 6 ? matB : matC)
      );
      board.position.set(pos.x, 1.8, pos.z);
      board.rotation.y = Math.atan2(t.x, t.z);
      scene.add(board);

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 2.6, 6),
        new THREE.MeshLambertMaterial({ color: 0x8b8b8b })
      );
      pole.position.set(pos.x, 1.3, pos.z);
      scene.add(pole);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  MARSHAL TOWERS
  // ═══════════════════════════════════════════════════════════════
  function _buildMarshalTowers(scene) {
    const markerT = [0.08, 0.22, 0.44, 0.60, 0.78];
    markerT.forEach((t, idx) => {
      const p = trackCurve.getPoint(t);
      const tangent = trackCurve.getTangent(t).normalize();
      const side = idx % 2 === 0 ? 1 : -1;
      const offset = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize()
        .multiplyScalar(side * (TRACK_WIDTH + 16));
      const base = p.clone().add(offset);

      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.65, 10, 8),
        new THREE.MeshLambertMaterial({ color: 0x727272 })
      );
      mast.position.set(base.x, 5, base.z);
      scene.add(mast);

      const booth = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 1.8, 3.2),
        new THREE.MeshLambertMaterial({ color: 0xe8e8e8 })
      );
      booth.position.set(base.x, 9.8, base.z);
      scene.add(booth);
    });
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
  function getForwardTangent(t) {
    if (!trackCurve) return new THREE.Vector3(0, 0, 1);
    const wrappedT = ((t % 1) + 1) % 1;
    const tan = trackCurve.getTangent(wrappedT).clone();
    tan.y = 0;
    if (tan.lengthSq() < 1e-8) return new THREE.Vector3(0, 0, 1);
    return tan.normalize();
  }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════
  return {
    build, getNearestT, getTrackYAt, isBumpZone, getForwardTangent,
    get curve()       { return trackCurve; },
    get checkpoints() { return checkpoints; },
    get width()       { return TRACK_WIDTH; },
    get totalLength() { return totalLength; },
    BUMP_SEGMENTS, TOTAL_LAPS,
  };
})();
