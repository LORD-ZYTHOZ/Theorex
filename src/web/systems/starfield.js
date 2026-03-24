// systems/starfield.js — starfield and nebula volume setup
import { state } from '../state.js';

export function addStarField(scene) {
  const THREE = window.THREE;

  // Dim blue-tinted background stars
  const dimCount = 4000;
  const dimPos = new Float32Array(dimCount * 3);
  for (let i = 0; i < dimCount; i++) {
    dimPos[i * 3]     = (Math.random() - 0.5) * 8000;
    dimPos[i * 3 + 1] = (Math.random() - 0.5) * 8000;
    dimPos[i * 3 + 2] = (Math.random() - 0.5) * 8000;
  }
  const dimGeo = new THREE.BufferGeometry();
  dimGeo.setAttribute('position', new THREE.BufferAttribute(dimPos, 3));
  scene.add(new THREE.Points(dimGeo, new THREE.PointsMaterial({
    color: 0x3399cc, size: 0.9, transparent: true, opacity: 0.30, sizeAttenuation: true
  })));

  // Mid-brightness stars
  const midCount = 1200;
  const midPos = new Float32Array(midCount * 3);
  for (let i = 0; i < midCount; i++) {
    midPos[i * 3]     = (Math.random() - 0.5) * 7000;
    midPos[i * 3 + 1] = (Math.random() - 0.5) * 7000;
    midPos[i * 3 + 2] = (Math.random() - 0.5) * 7000;
  }
  const midGeo = new THREE.BufferGeometry();
  midGeo.setAttribute('position', new THREE.BufferAttribute(midPos, 3));
  scene.add(new THREE.Points(midGeo, new THREE.PointsMaterial({
    color: 0x88ddff, size: 1.6, transparent: true, opacity: 0.50, sizeAttenuation: true
  })));

  // Bright accent stars
  const brightCount = 180;
  const brightPos = new Float32Array(brightCount * 3);
  for (let i = 0; i < brightCount; i++) {
    brightPos[i * 3]     = (Math.random() - 0.5) * 6000;
    brightPos[i * 3 + 1] = (Math.random() - 0.5) * 6000;
    brightPos[i * 3 + 2] = (Math.random() - 0.5) * 6000;
  }
  const brightGeo = new THREE.BufferGeometry();
  brightGeo.setAttribute('position', new THREE.BufferAttribute(brightPos, 3));
  scene.add(new THREE.Points(brightGeo, new THREE.PointsMaterial({
    color: 0xccefff, size: 3.2, transparent: true, opacity: 0.80, sizeAttenuation: true
  })));
}

export function addNebulaVolumes(scene) {
  const THREE = window.THREE;
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0x001a2e, transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false })
  );
  scene.add(atmo);
}

export function addNexusStarfield(scene) {
  const THREE = window.THREE;

  function makeLayer({ count, radiusMin, radiusMax, color, size, opacity }) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = radiusMin + Math.random() * (radiusMax - radiusMin);
      const theta = Math.acos(2 * Math.random() - 1);
      const phi = 2 * Math.PI * Math.random();
      positions[i * 3]     = r * Math.sin(theta) * Math.cos(phi);
      positions[i * 3 + 1] = r * Math.sin(theta) * Math.sin(phi);
      positions[i * 3 + 2] = r * Math.cos(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color, size, opacity, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    scene.add(pts);
    return pts;
  }
  return {
    dim:   makeLayer({ count: 3000, radiusMin: 1500, radiusMax: 3000, color: 0x0a1a3a, size: 1.0, opacity: 0.25 }),
    mid:   makeLayer({ count: 800,  radiusMin: 800,  radiusMax: 1500, color: 0x1a2a5a, size: 2.0, opacity: 0.40 }),
    close: makeLayer({ count: 100,  radiusMin: 400,  radiusMax: 800,  color: 0x2244aa, size: 3.5, opacity: 0.60 }),
  };
}

export function cleanupNexusStarfield(scene, refs) {
  const THREE = window.THREE;
  [refs.dim, refs.mid, refs.close].forEach(pts => {
    if (!pts) return;
    scene.remove(pts);
    pts.geometry.dispose();
    pts.material.dispose();
  });
}

export function addNexusGlowRings(scene) {
  const THREE = window.THREE;
  const configs = [
    { radius: 80,  tube: 0.4, color: 0x4da6ff, opacity: 0.15 },
    { radius: 150, tube: 0.3, color: 0x9d6bff, opacity: 0.10 },
    { radius: 220, tube: 0.5, color: 0xff4dd2, opacity: 0.08 },
  ];
  const rings = configs.map(({ radius, tube, color, opacity }) => {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 16, 100),
      new THREE.MeshBasicMaterial({ color, opacity, transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    mesh.rotation.x = Math.PI / 2;
    scene.add(mesh);
    return mesh;
  });
  return {
    rings,
    tick: t => {
      rings[0].rotation.y = t * 0.15;
      rings[1].rotation.y = -t * 0.10;
      rings[2].rotation.y = t * 0.07;
    },
  };
}
