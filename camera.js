// ═══════════════════════════════════════════════════════════════
//  camera.js  —  Split-screen chase cameras
// ═══════════════════════════════════════════════════════════════

const CameraSystem = (() => {

  // Chase cam offsets
  const CAM_OFFSET_BACK   = 9.0;   // behind bike
  const CAM_OFFSET_UP     = 4.2;   // height
  const CAM_LAG           = 0.10;  // position lag (0=instant, 1=no follow)
  const CAM_ROT_LAG       = 0.12;  // rotation lag

  let cam1, cam2;
  let camPos1 = new THREE.Vector3();
  let camPos2 = new THREE.Vector3();
  let camLook1 = new THREE.Vector3();
  let camLook2 = new THREE.Vector3();

  function init(w, h) {
    cam1 = new THREE.PerspectiveCamera(70, (w / 2) / h, 0.3, 2000);
    cam1.position.set(0, 80, 520);
    cam1.lookAt(0, 0, 400);

    cam2 = new THREE.PerspectiveCamera(70, (w / 2) / h, 0.3, 2000);
    cam2.position.set(0, 80, 520);
    cam2.lookAt(0, 0, 400);

    // Init lerp targets to same position
    camPos1.copy(cam1.position);
    camPos2.copy(cam2.position);
    camLook1.set(0, 0, 400);
    camLook2.set(0, 0, 400);

    return { cam1, cam2 };
  }

  function resize(w, h) {
    const aspect = (w / 2) / h;
    if (cam1) { cam1.aspect = aspect; cam1.updateProjectionMatrix(); }
    if (cam2) { cam2.aspect = aspect; cam2.updateProjectionMatrix(); }
  }

  function update(bikeState1, bikeState2, dt) {
    _updateCam(cam1, camPos1, camLook1, bikeState1, dt);
    _updateCam(cam2, camPos2, camLook2, bikeState2, dt);
  }

  function _updateCam(cam, camPos, camLook, bikeState, dt) {
    const bike = bikeState;

    // Desired camera position: behind and above the bike
    const backDir = new THREE.Vector3(
      -Math.sin(bike.angle),
      0,
      -Math.cos(bike.angle)
    );

    const desired = bike.position.clone()
      .addScaledVector(backDir, CAM_OFFSET_BACK)
      .add(new THREE.Vector3(0, CAM_OFFSET_UP, 0));

    // Smoothly interpolate camera position
    const lerpFactor = 1.0 - Math.pow(CAM_LAG, dt * 60);
    camPos.lerp(desired, lerpFactor);
    cam.position.copy(camPos);

    // Look at: slightly ahead of bike
    const aheadDir = new THREE.Vector3(
      Math.sin(bike.angle),
      0,
      Math.cos(bike.angle)
    );
    const lookTarget = bike.position.clone()
      .addScaledVector(aheadDir, 3.5)
      .add(new THREE.Vector3(0, 0.8, 0));

    const rotLerp = 1.0 - Math.pow(CAM_ROT_LAG, dt * 60);
    camLook.lerp(lookTarget, rotLerp);
    cam.lookAt(camLook);
  }

  function getCam1() { return cam1; }
  function getCam2() { return cam2; }

  return { init, resize, update, getCam1, getCam2 };
})();
