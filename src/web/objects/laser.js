// objects/laser.js — buildNucleusLaser, updateNucleusLaser
// IMPORTANT: Do NOT change logic in these functions.
import { state } from '../state.js';

function _orientBeam(mesh, from, to) {
  const THREE = window.THREE;
  const dir = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
  const len = dir.length();
  if (len < 1) return;
  mesh.scale.set(1, len, 1);
  mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
}

export function buildNucleusLaser(scene) {
  const THREE = window.THREE;

  if (state.nucleusLaser) {
    scene.remove(state.nucleusLaser.inner);
    scene.remove(state.nucleusLaser.outer);
    scene.remove(state.nucleusLaser.glow);
  }
  // Inner core: white-cyan, thin cylinder
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 1, 8, 1),
    new THREE.MeshBasicMaterial({ color: 0xddf0ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  // Mid violet: wider
  const outer = new THREE.Mesh(
    new THREE.CylinderGeometry(2.8, 2.8, 1, 8, 1),
    new THREE.MeshBasicMaterial({ color: 0x8833ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  // Wide soft glow: very wide, very transparent
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(7.0, 7.0, 1, 8, 1),
    new THREE.MeshBasicMaterial({ color: 0x5500cc, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  scene.add(inner); scene.add(outer); scene.add(glow);
  state.nucleusLaser = { inner, outer, glow };
}

export function updateNucleusLaser() {
  if (!state.nexusMode || !state.nucleusLaser) return;
  const target = state.allNodes.find(n => n.__isNucleus && n.__nucleusRank === 1);
  if (!target || target.x == null) return;
  const from = { x: 0, y: 0, z: 0 };
  const to   = { x: target.x, y: target.y, z: target.z };
  _orientBeam(state.nucleusLaser.inner, from, to);
  _orientBeam(state.nucleusLaser.outer, from, to);
  _orientBeam(state.nucleusLaser.glow,  from, to);
  // Pulse opacity — faster than heartbeat
  const t = state.nexusUniforms.uTime.value;
  const pulse = 0.85 + 0.15 * Math.sin(t * 4.7);
  state.nucleusLaser.inner.material.opacity = 0.95 * pulse;
  state.nucleusLaser.outer.material.opacity = 0.55 * pulse;
  state.nucleusLaser.glow.material.opacity  = 0.18 * pulse;
}
