// systems/bloom.js — postprocessing bloom setup
import { state } from '../state.js';

export function setupBloom(container) {
  const THREE = window.THREE;
  const POSTPROCESSING = window.POSTPROCESSING;

  try {
    const { EffectComposer, RenderPass, BloomEffect, ChromaticAberrationEffect, EffectPass } = POSTPROCESSING;
    const renderer = state.graph3d.renderer();
    const scene    = state.graph3d.scene();
    const camera   = state.graph3d.camera();
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Tight bloom — crisp corona on bright nodes only, not diffuse fog
    const bloom = new BloomEffect({ intensity: 2.8, radius: 0.38, luminanceThreshold: 0.20, luminanceSmoothing: 0.06 });
    state.nexusBloomRef = bloom;
    state.galaxyBloomRef = bloom; // shared ref for nexus intensity swap
    // Subtle chromatic aberration — digital lens feel
    const ca = ChromaticAberrationEffect
      ? new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0008, 0.0005) })
      : null;
    composer.addPass(new EffectPass(camera, bloom, ...(ca ? [ca] : [])));
    // Override renderer.render with re-entrancy guard
    let composing = false;
    const orig = renderer.render.bind(renderer);
    renderer.render = (s, c) => {
      if (!composing && s === scene) { composing = true; composer.render(); composing = false; }
      else orig(s, c);
    };
    const ro = new ResizeObserver(() => composer.setSize(container.clientWidth, container.clientHeight));
    ro.observe(container);
  } catch (e) {
    // Graceful degradation — bloom unavailable, graph still works
    console.warn('Bloom unavailable:', e.message);
    const r = state.graph3d.renderer();
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;
  }
}
