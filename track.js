// ????????????????????????????????????????????????????????????????//  track.js  ?? Monza-inspired circuit (high-speed + chicanes)
//  30 control points 繚 clockwise 繚 flat terrain
//
//  [FIX] computeFrenetFrames 撘瑕?? Y 頠詨?銝?閫?捱?剛??游?
//  [FIX] getNearestT 撅?冽?撠翰???踹?頝喳?
//  [NEW] 鞈賡??孵?蝞剝 (瘥?1/18 銝???脖?閫?
// ????????????????????????????????????????????????????????????????
const Track = (() => {

  // ?? Monza 憸冽鞈賡? ??30 ?批暺??????????????????????????
  // 摨扳?撌脫迤閬???-1??1嚗?銋?TRACK_SCALE
  //
  //   銝餌蝺???Variante del Rettifilo (T1/T2 皜?)
  //   ??Curva Grande ?瑕憫 ??Variante della Roggia
  //   ??Lesmo 1 / Lesmo 2 ??Serraglio ?渡?
  //   ??Ascari 銴?敶???Parabolica ?瑕敶?銝餌蝺?  //
  const RAW_XZ = [
    [  0.38, -0.58 ],  //  0  start / finish
    [  0.62, -0.58 ],  //  1  long straight
    [  0.82, -0.56 ],  //  2
    [  0.92, -0.48 ],  //  3
    [  0.92, -0.28 ],  //  4  right hairpin
    [  0.72, -0.22 ],  //  5
    [  0.22, -0.22 ],  //  6  middle straight
    [  0.14, -0.18 ],  //  7  small kink
    [  0.08, -0.16 ],  //  8
    [ -0.08, -0.02 ],  //  9  climb to top-left
    [ -0.30,  0.20 ],  // 10
    [ -0.46,  0.40 ],  // 11
    [ -0.62,  0.62 ],  // 12  upper-left corner
    [ -0.82,  0.58 ],  // 13
    [ -0.92,  0.42 ],  // 14
    [ -0.76, -0.06 ],  // 15  left sweep down
    [ -0.72, -0.40 ],  // 16
    [ -0.56, -0.58 ],  // 17
    [ -0.18, -0.58 ],  // 18
    [  0.10, -0.54 ],  // 19
  ];

  // Monza 憸冽?見隞亙像?啁銝鳴?銝?擃?撌?  const ELEVATION = new Array(RAW_XZ.length).fill(0);

  const TRACK_SCALE     = 520;
  const TRACK_ELEVATION = new Array(RAW_XZ.length).fill(0);
  const ELEVATION_SCALE = 1.0;
  const TRACK_WIDTH     = 12;
  const ROAD_LIFT       = 0.08;
  const ROAD_DECAL_LIFT = ROAD_LIFT + 0.03;
  const TOTAL_LAPS      = 5;
  const BUMP_SEGMENTS   = [3, 4, 14, 15];

  const BARRIER_SKIP_RANGES = [];  // ?∠?鈭斗?嚗畾菟?風甈?
  const BARRIER_HEIGHT = 0.55;
  const BARRIER_OFFSET = TRACK_WIDTH + 1.6;

  let trackCurve  = null;
  let checkpoints = [];
  let totalLength = 0;
  let bakedPath   = [];
  let obstacles   = [];

  // ????????????????????????????????????????????????????????????????  //  BUILD
  // ????????????????????????????????????????????????????????????????
  function build(scene) {
    const ctrlPts = RAW_XZ.map(([x, z], i) =>
      new THREE.Vector3(x * TRACK_SCALE, TRACK_ELEVATION[i] * ELEVATION_SCALE, z * TRACK_SCALE)
    );

    trackCurve  = new THREE.CatmullRomCurve3(ctrlPts, true, 'catmullrom', 0.5);
    totalLength = trackCurve.getLength();

    // ???詨?靽桀儔嚗誑銝? Y 頠貊 up嚗??Frenet Frame 蝝舐??剛?
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

    // ?? 600 暺? getNearestT ??    bakedPath = [];
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
    _buildTrackObstacles(scene);
    _buildCheckpoints();

    return { trackCurve, checkpoints, totalLength, BUMP_SEGMENTS, TRACK_WIDTH, obstacles };
  }

  // ????????????????????????????????????????????????????????????????  //  GROUND
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

  // ????????????????????????????????????????????????????????????????  //  ROAD MESH
  // ????????????????????????????????????????????????????????????????
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

  // ?? RUNOFF APRON (靽桀儔鞈賡??楠?游? / 鋆撥閬死?腹) ???????????
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

  // ????????????????????????????????????????????????????????????????  //  DIRECTION ARROWS  ???迄?拙振甇?Ⅱ銵脫??  //  瘥?1/18 ?銝?漁暺銝?蝞剝嚗票?刻楝?Ｖ?
  // ????????????????????????????????????????????????????????????????
  function _buildDirectionArrows(scene) {
    const ARROW_COUNT = 18;
    const ARROW_LEN   = 6.0;    // ??蝮賡 (m)
    const ARROW_W     = 2.8;    // ?祝 (m)
    const Y_LIFT      = ROAD_DECAL_LIFT + 0.03;

    const mat = new THREE.MeshBasicMaterial({
      color:       0xFFD700,   // 鈭桅?
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

      // ?冽偌撟?tangent 閮?蝛拙??椰?單????computeFrenetFrames ??頛荔?
      const up     = new THREE.Vector3(0, 1, 0);
      const tHoriz = new THREE.Vector3(tan.x, 0, tan.z).normalize();
      const binorm = new THREE.Vector3().crossVectors(tHoriz, up).normalize();

      // 銝?敶ｇ?撠垢?典?嚗??敺?
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

  // ????????????????????????????????????????????????????????????????  //  BARRIERS
  // ????????????????????????????????????????????????????????????????
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

  // ????????????????????????????????????????????????????????????????  //  START LINE + GANTRY
  // ????????????????????????????????????????????????????????????????
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

    // 韏瑁??梢?
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

  function _finishObject(obj) {
    obj.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return obj;
  }

  function _buildGrandstand(scene) {
    const root = new THREE.Group();
    const sfX = 0.62 * TRACK_SCALE + TRACK_WIDTH + 18;
    const sfZ0 = -0.12 * TRACK_SCALE;
    const sfZ1 = 0.62 * TRACK_SCALE;
    const len = (sfZ1 - sfZ0) * 0.82;
    const centZ = (sfZ0 + sfZ1) / 2;
    const concreteMat = new THREE.MeshLambertMaterial({ color: 0x8d9399 });
    const seatMatA = new THREE.MeshLambertMaterial({ color: 0x1672d6 });
    const seatMatB = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x173b76 });
    const steelMat = new THREE.MeshLambertMaterial({ color: 0x5f666f });

    for (let i = 0; i < 6; i++) {
      const depth = 3.2 + i * 1.8;
      const height = 0.9 + i * 0.95;
      const row = new THREE.Mesh(new THREE.BoxGeometry(depth, 0.8, len), concreteMat);
      row.position.set(sfX + depth * 0.5, height, centZ);
      root.add(row);

      const seatStrip = new THREE.Mesh(
        new THREE.BoxGeometry(depth + 0.2, 0.22, len - 2.4),
        i % 2 === 0 ? seatMatA : seatMatB
      );
      seatStrip.position.set(sfX + depth * 0.5, height + 0.46, centZ);
      root.add(seatStrip);
    }

    const platform = new THREE.Mesh(new THREE.BoxGeometry(18, 0.8, len + 8), concreteMat);
    platform.position.set(sfX + 10, 0.4, centZ);
    root.add(platform);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(21, 0.8, len + 10), roofMat);
    roof.position.set(sfX + 11, 10.6, centZ);
    root.add(roof);

    for (const z of [sfZ0 + 10, centZ, sfZ1 - 10]) {
      for (const x of [sfX + 2, sfX + 10, sfX + 18]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 10.5, 0.6), steelMat);
        pillar.position.set(x, 5.1, z);
        root.add(pillar);
      }
    }

    for (let i = 0; i < 4; i++) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, len + 2), steelMat);
      brace.position.set(sfX + 4 + i * 4.5, 9.6, centZ);
      root.add(brace);
    }

    const stairL = new THREE.Mesh(new THREE.BoxGeometry(2.4, 5.6, 8), concreteMat);
    stairL.position.set(sfX - 0.5, 2.8, sfZ0 + 12);
    root.add(stairL);
    const stairR = stairL.clone();
    stairR.position.z = sfZ1 - 12;
    root.add(stairR);

    root.position.y = 0.05;
    scene.add(_finishObject(root));
  }

  function _buildPitComplex(scene) {
    const root = new THREE.Group();
    const baseX = 0.62 * TRACK_SCALE - TRACK_WIDTH - 24;
    const z0 = -0.08 * TRACK_SCALE;
    const z1 = 0.58 * TRACK_SCALE;
    const len = z1 - z0;
    const centerZ = (z0 + z1) / 2;
    const concreteMat = new THREE.MeshLambertMaterial({ color: 0x777c84 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x6f8fa6 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x34383d });
    const accentMat = new THREE.MeshLambertMaterial({ color: 0x1f4f9d });

    const block = new THREE.Mesh(new THREE.BoxGeometry(26, 9, len), concreteMat);
    block.position.set(baseX - 10, 4.5, centerZ);
    root.add(block);

    const upper = new THREE.Mesh(new THREE.BoxGeometry(18, 4, len - 18), darkMat);
    upper.position.set(baseX - 11, 10.5, centerZ);
    root.add(upper);

    const glassBand = new THREE.Mesh(new THREE.BoxGeometry(26.4, 2.3, len - 8), glassMat);
    glassBand.position.set(baseX - 10, 7.4, centerZ);
    root.add(glassBand);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(28, 0.7, len + 6), accentMat);
    roof.position.set(baseX - 10, 13, centerZ);
    root.add(roof);

    const pitLaneWall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.7, len + 12), new THREE.MeshLambertMaterial({ color: 0xd3d6db }));
    pitLaneWall.position.set(baseX + 2, 0.85, centerZ);
    root.add(pitLaneWall);

    const garageCount = 16;
    for (let i = 0; i < garageCount; i++) {
      const z = z0 + (i + 0.5) * (len / garageCount);
      const bay = new THREE.Mesh(new THREE.BoxGeometry(7.4, 3.5, 2.6), darkMat);
      bay.position.set(baseX + 0.6, 1.75, z);
      root.add(bay);

      const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.2, 2.0), new THREE.MeshLambertMaterial({ color: 0xe8edf2 }));
      shutter.position.set(baseX + 4.1, 1.35, z);
      root.add(shutter);
    }

    for (let i = 0; i < 6; i++) {
      const z = z0 + 16 + i * 30;
      const truck = new THREE.Mesh(
        new THREE.BoxGeometry(4.4, 2.3, 8.6),
        new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? 0xc42c24 : 0xffffff })
      );
      truck.position.set(baseX - 28, 1.15, z);
      root.add(truck);
    }

    const hospitality = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 24), new THREE.MeshLambertMaterial({ color: 0x515861 }));
    hospitality.position.set(baseX - 32, 3, centerZ + 18);
    root.add(hospitality);

    scene.add(_finishObject(root));
  }

  function _buildSponsorBoards(scene) {
    const SEG = 140;
    const pts = trackCurve.getSpacedPoints(SEG);
    const frames = trackCurve.computeFrenetFrames(SEG, true);
    const boardMats = [
      new THREE.MeshLambertMaterial({ color: 0x0d4aa6 }),
      new THREE.MeshLambertMaterial({ color: 0xc71f2c }),
      new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }),
      new THREE.MeshLambertMaterial({ color: 0x1f1f1f }),
    ];
    const supportMat = new THREE.MeshLambertMaterial({ color: 0x8a8f96 });

    for (let i = 0; i < SEG; i += 5) {
      if ((i > 22 && i < 34) || (i > 96 && i < 110)) continue;
      const p = pts[i];
      const b = frames.binormals[i];
      const t = trackCurve.getTangent(i / SEG).normalize();
      const side = i % 10 < 5 ? -1 : 1;
      const pos = p.clone().addScaledVector(b, side * (TRACK_WIDTH + 10 + (i % 3) * 1.6));
      const width = 6 + (i % 4) * 1.2;
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(width, 2.8, 0.45),
        boardMats[i % boardMats.length]
      );
      board.position.set(pos.x, 2.2, pos.z);
      board.rotation.y = Math.atan2(t.x, t.z);
      scene.add(_finishObject(board));

      for (const offset of [-width * 0.32, width * 0.32]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 6), supportMat);
        pole.position.set(pos.x + Math.cos(board.rotation.y) * offset, 1.5, pos.z - Math.sin(board.rotation.y) * offset);
        scene.add(_finishObject(pole));
      }
    }
  }

  function _buildMarshalTowers(scene) {
    const markerT = [0.08, 0.22, 0.34, 0.48, 0.60, 0.78];
    const mastMat = new THREE.MeshLambertMaterial({ color: 0x7a828c });
    const boothMat = new THREE.MeshLambertMaterial({ color: 0xf2eee4 });
    const accentMat = new THREE.MeshLambertMaterial({ color: 0xff8a00 });

    markerT.forEach((t, idx) => {
      const p = trackCurve.getPoint(t);
      const tangent = trackCurve.getTangent(t).normalize();
      const side = idx % 2 === 0 ? 1 : -1;
      const offset = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize()
        .multiplyScalar(side * (TRACK_WIDTH + 18));
      const base = p.clone().add(offset);
      const tower = new THREE.Group();

      const mast = new THREE.Mesh(new THREE.BoxGeometry(2.4, 11, 2.4), mastMat);
      mast.position.set(base.x, 5.5, base.z);
      tower.add(mast);

      const booth = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.4, 4.2), boothMat);
      booth.position.set(base.x, 10.7, base.z);
      tower.add(booth);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.4, 4.8), accentMat);
      roof.position.set(base.x, 12.2, base.z);
      tower.add(roof);

      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.3, 8), accentMat);
      beacon.position.set(base.x, 13.1, base.z);
      tower.add(beacon);

      scene.add(_finishObject(tower));
    });
  }

  function _buildClubTireWall(scene) {
    const clubCenter = trackCurve.getPoint(18 / RAW_XZ.length);
    const radius = TRACK_WIDTH + 4.5;
    const tireGeo = new THREE.CylinderGeometry(0.68, 0.68, 0.85, 10);
    const tireMats = [
      new THREE.MeshLambertMaterial({ color: 0x121212 }),
      new THREE.MeshLambertMaterial({ color: 0xcf1f2b }),
      new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }),
    ];

    for (let layer = 0; layer < 2; layer++) {
      for (let a = -102; a <= 102; a += 15) {
        const rad = (a * Math.PI) / 180;
        const tire = new THREE.Mesh(tireGeo, tireMats[Math.abs(Math.round(a / 15)) % tireMats.length]);
        tire.position.set(
          clubCenter.x + Math.cos(rad) * radius,
          0.42 + layer * 0.9,
          clubCenter.z + Math.sin(rad) * radius
        );
        tire.rotation.z = Math.PI / 2;
        scene.add(_finishObject(tire));
      }
    }

    for (let i = -2; i <= 2; i++) {
      const cone = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.45, 1.2, 6),
        new THREE.MeshLambertMaterial({ color: 0xff7a00 })
      );
      cone.position.set(clubCenter.x - 8 + i * 2.1, 0.6, clubCenter.z + radius + 4);
      scene.add(_finishObject(cone));
    }
  }

  function _buildTrees(scene) {
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5e3b1d });
    const leafMats = [
      new THREE.MeshLambertMaterial({ color: 0x2d5f1f }),
      new THREE.MeshLambertMaterial({ color: 0x3f7728 }),
      new THREE.MeshLambertMaterial({ color: 0x4d8a2e }),
    ];
    const SEG = 120;
    const pts = trackCurve.getSpacedPoints(SEG);
    const frames = trackCurve.computeFrenetFrames(SEG, true);

    function addBroadleaf(position, scale) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * scale, 0.34 * scale, 2.8 * scale, 7), trunkMat);
      trunk.position.y = 1.4 * scale;
      tree.add(trunk);
      for (let i = 0; i < 3; i++) {
        const canopy = new THREE.Mesh(
          new THREE.SphereGeometry((1.3 + i * 0.15) * scale, 8, 7),
          leafMats[i % leafMats.length]
        );
        canopy.position.set((i - 1) * 0.3 * scale, 3.2 * scale + i * 0.45 * scale, (i % 2 === 0 ? 0.2 : -0.2) * scale);
        tree.add(canopy);
      }
      tree.position.copy(position);
      scene.add(_finishObject(tree));
    }

    function addPine(position, scale) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * scale, 0.28 * scale, 3.6 * scale, 7), trunkMat);
      trunk.position.y = 1.8 * scale;
      tree.add(trunk);
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry((1.4 - i * 0.18) * scale, 2.4 * scale, 8),
          leafMats[(i + 1) % leafMats.length]
        );
        cone.position.y = 3.2 * scale + i * 1.0 * scale;
        tree.add(cone);
      }
      tree.position.copy(position);
      scene.add(_finishObject(tree));
    }

    for (let i = 0; i < SEG; i += 2) {
      const b = frames.binormals[i];
      const p = pts[i];
      for (const side of [-1, 1]) {
        const clusterBase = p.clone().addScaledVector(b, side * (TRACK_WIDTH + 12 + (i % 5) * 2.2));
        for (let c = 0; c < 2; c++) {
          const tangent = getForwardTangent(i / SEG);
          const depth = (c === 0 ? 0 : 7 + (i % 3) * 3);
          const lateral = (Math.sin(i * 1.7 + c * 2.1) * 3.6);
          const pos = clusterBase.clone()
            .addScaledVector(b, side * lateral)
            .addScaledVector(tangent, depth);
          const scale = 0.9 + ((i + c) % 5) * 0.12;
          if ((i + c) % 3 === 0) addPine(pos, scale);
          else addBroadleaf(pos, scale);
        }
      }
    }

    const infieldMats = [
      new THREE.MeshLambertMaterial({ color: 0xb8b86a }),
      new THREE.MeshLambertMaterial({ color: 0xd7d77b }),
    ];
    for (let i = 0; i < 18; i++) {
      const hay = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 1.4, 1.6, 18),
        infieldMats[i % infieldMats.length]
      );
      hay.position.set(-160 + (i % 6) * 24, 0.8, -40 + Math.floor(i / 6) * 28);
      scene.add(_finishObject(hay));
    }
  }

  function _buildTrackObstacles(scene) {
    obstacles = [];
    const coneMat = new THREE.MeshLambertMaterial({ color: 0xff6a00 });
    const coneStripeMat = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });
    const baleMat = new THREE.MeshLambertMaterial({ color: 0xd7c45c });
    const barrelMat = new THREE.MeshLambertMaterial({ color: 0x1877c9 });
    const capMat = new THREE.MeshLambertMaterial({ color: 0xececec });

    function addCone(position, scale = 1) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * scale, 0.42 * scale, 0.92 * scale, 6), coneMat);
      body.position.y = 0.46 * scale;
      group.add(body);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * scale, 0.28 * scale, 0.18 * scale, 6), coneStripeMat);
      stripe.position.y = 0.42 * scale;
      group.add(stripe);
      group.position.copy(position);
      scene.add(_finishObject(group));
      obstacles.push({ position: position.clone(), radius: 0.8 * scale, speedPenalty: 0.76 });
    }

    function addBale(position, scale = 1) {
      const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.9 * scale, 0.9 * scale, 1.5 * scale, 18), baleMat);
      bale.rotation.z = Math.PI / 2;
      bale.position.copy(position);
      scene.add(_finishObject(bale));
      obstacles.push({ position: position.clone(), radius: 1.35 * scale, speedPenalty: 0.52 });
    }

    function addBarrel(position, scale = 1) {
      const group = new THREE.Group();
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * scale, 0.56 * scale, 1.2 * scale, 14), barrelMat);
      barrel.position.y = 0.6 * scale;
      group.add(barrel);
      const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.48 * scale, 0.48 * scale, 0.08 * scale, 14), capMat);
      capTop.position.y = 1.16 * scale;
      group.add(capTop);
      const capBottom = capTop.clone();
      capBottom.position.y = 0.04 * scale;
      group.add(capBottom);
      group.position.copy(position);
      scene.add(_finishObject(group));
      obstacles.push({ position: position.clone(), radius: 1.0 * scale, speedPenalty: 0.6 });
    }

    const placements = [
      { t: 0.07, side: -0.12, type: 'cone', scale: 1.0 },
      { t: 0.095, side: 0.18, type: 'cone', scale: 1.0 },
      { t: 0.18, side: -0.22, type: 'barrel', scale: 1.0 },
      { t: 0.31, side: 0.16, type: 'cone', scale: 1.1 },
      { t: 0.34, side: -0.08, type: 'bale', scale: 0.95 },
      { t: 0.46, side: 0.2, type: 'barrel', scale: 1.0 },
      { t: 0.58, side: -0.18, type: 'cone', scale: 1.1 },
      { t: 0.66, side: 0.1, type: 'bale', scale: 1.0 },
      { t: 0.74, side: -0.15, type: 'barrel', scale: 0.95 },
      { t: 0.88, side: 0.22, type: 'cone', scale: 1.0 },
    ];

    for (const placement of placements) {
      const p = trackCurve.getPoint(placement.t);
      const tangent = getForwardTangent(placement.t);
      const side = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
      const pos = p.clone().addScaledVector(side, placement.side * TRACK_WIDTH);
      pos.y += 0.02;
      if (placement.type === 'cone') addCone(pos, placement.scale);
      else if (placement.type === 'bale') addBale(pos, placement.scale);
      else addBarrel(pos, placement.scale);
    }
  }

  // ????????????????????????????????????????????????????????????????  //  CHECKPOINTS
  // ????????????????????????????????????????????????????????????????
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

  // ????????????????????????????????????????????????????????????????  //  UTILS
  // ????????????????????????????????????????????????????????????????
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

  // ????????????????????????????????????????????????????????????????  //  PUBLIC API
  // ????????????????????????????????????????????????????????????????
  return {
    build, getNearestT, getTrackYAt, isBumpZone, getForwardTangent,
    get curve()       { return trackCurve; },
    get checkpoints() { return checkpoints; },
    get obstacles()   { return obstacles; },
    get width()       { return TRACK_WIDTH; },
    get totalLength() { return totalLength; },
    BUMP_SEGMENTS, TOTAL_LAPS,
  };
})();
