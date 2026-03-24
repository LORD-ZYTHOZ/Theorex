// shaders/edge.js — GLSL shaders for NEXUS spectral tether edges

export const NEXUS_EDGE_VERT = `
  attribute float aProgress;
  varying   float vProgress;
  void main() {
    vProgress   = aProgress;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

export const NEXUS_EDGE_FRAG = `
  uniform float uTime;
  uniform vec3  uColor;
  uniform float uActive;
  uniform float uBoost;
  uniform float uScrollSpeed;
  uniform float uWeight;
  uniform float uThreshold;
  varying float vProgress;

  float binaryChar(float p, float t, float speed) {
    float cell    = floor(p * 32.0);
    float cellFrac = fract(p * 32.0);
    float seed    = cell * 127.1 + floor(t * speed * 4.0) * 311.7;
    float h       = fract(sin(seed) * 43758.5453);
    float bit     = step(0.5, h);
    float centre  = clamp(1.0 - abs(cellFrac - 0.5) * 2.8, 0.0, 1.0);
    return mix(0.28, 1.0, bit) * centre;
  }

  void main() {
    if (uWeight < uThreshold) discard;
    float scrolled = fract(vProgress - mod(uTime * uScrollSpeed, 1.0));
    if (uActive < 0.5) {
      float dash    = step(0.5, fract(vProgress * 14.0));
      float flicker = 0.35 + 0.65 * sin(uTime * 4.3 + vProgress * 25.0);
      float bits    = binaryChar(scrolled, uTime, uScrollSpeed);
      float alpha   = 0.13 * dash * flicker * (0.6 + 0.4 * bits);
      gl_FragColor  = vec4(uColor * 0.55, alpha);
    } else {
      float boost    = 1.0 + uBoost * 0.9;
      float bits     = binaryChar(scrolled, uTime, uScrollSpeed);
      float scrolled2 = fract(vProgress - mod(uTime * uScrollSpeed * 0.6, 1.0));
      float bits2    = binaryChar(scrolled2, uTime, uScrollSpeed * 0.6) * 0.45;
      float intensity = 0.20 + uBoost * 0.28 + (bits + bits2) * 0.52;
      float pulse    = pow(max(0.0, sin((vProgress - mod(uTime * (0.32 + uBoost * 0.45), 1.0)) * 9.0)), 4.0) * 0.35;
      float alpha    = clamp(intensity + pulse, 0.0, 1.0);
      gl_FragColor   = vec4(uColor * boost, alpha);
    }
  }`;

// ── GLSL: Fibonacci particle sphere with neural hum jitter ─────────────────
export const NEXUS_VERT = `
  uniform float uTime;
  attribute float aJitter;
  attribute float aPhase;
  void main() {
    vec3 pos = position;
    float j = aJitter * 0.40;
    pos.x += sin(uTime * 1.30 + aPhase)        * j;
    pos.y += cos(uTime * 0.92 + aPhase * 1.37) * j;
    pos.z += sin(uTime * 1.15 + aPhase * 0.81) * j;
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position  = projectionMatrix * mvPos;
    gl_PointSize = clamp(340.0 / -mvPos.z, 1.2, 7.0);
  }`;

// ── GLSL: Binary digit fragment — scrolls upward, circular clip ────────────
export const NEXUS_FRAG = `
  uniform float     uTime;
  uniform vec3      uColor;
  uniform float     uIntensity;
  uniform sampler2D uBinaryTex;
  void main() {
    vec2 uv = gl_PointCoord;
    uv.y = mod(uv.y + uTime * 0.13, 1.0);   // scroll binary text upward
    float alpha = texture2D(uBinaryTex, uv).r;
    if (alpha < 0.12) discard;
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float fade = 1.0 - d * 1.9;
    gl_FragColor = vec4(uColor * uIntensity, alpha * fade * 0.90);
  }`;
