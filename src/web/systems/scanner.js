// systems/scanner.js — scanner ring sweeping holographic slice

export function addScannerPlane(scene) {
  const THREE = window.THREE;

  // Scan ring — sweeps vertically like a sensor ping, no square artifacts
  const geo = new THREE.TorusGeometry(700, 1.2, 6, 80);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);
  let y = -500, dir = 1, lastT = 0;
  (function tick(t) {
    const dt = Math.min(lastT ? t - lastT : 16, 50); lastT = t;
    y += 0.07 * dt * dir;
    if (y > 500) { dir = -1; mat.opacity = 0; }
    else if (y < -500) { dir = 1; mat.opacity = 0; }
    ring.position.y = y;
    if (mat.opacity < 0.55) mat.opacity = Math.min(0.55, mat.opacity + 0.00008 * dt);
    requestAnimationFrame(tick);
  })(0);
}
