// shaders/node.js — GLSL shaders for NEXUS voxel binary node objects

export const NEXUS_NODE_VERT = `
  uniform float uTime;
  uniform float uPulse;
  uniform float uDegree;
  uniform vec3  uColor;
  uniform float uCameraDistance;
  attribute float aPhaseOffset;
  attribute vec3  aOrbitAxis;
  attribute float aCharType;
  varying float   vCharType;
  varying float   vPulse;
  varying vec3    vColor;
  varying float   vPhaseOffset;
  varying float   vDegree;

  void main() {
    vCharType    = aCharType;
    vPulse       = uPulse;
    vColor       = uColor;
    vPhaseOffset = aPhaseOffset;
    vDegree      = uDegree;

    vec3  pos = position;
    float t   = uTime;
    // Per-point frequency from orbit axis variety (0.14 – 0.26)
    float f   = 0.14 + abs(aOrbitAxis.x) * 0.12 + uPulse * 0.08;
    // Amplitude scales with distance from centre — outer chars drift more
    float amp = length(pos) * (0.12 + uPulse * 0.08);

    // Same multi-harmonic drift as nucleus, half the speed
    float dx = sin(t * f        + aPhaseOffset)            + sin(t * f * 2.17 + aPhaseOffset * 0.73) * 0.45;
    float dy = cos(t * f * 1.31 + aPhaseOffset * 1.07)    + cos(t * f * 1.73 + aPhaseOffset * 0.91) * 0.45;
    float dz = sin(t * f * 0.79 + aPhaseOffset * 0.83)    + sin(t * f * 1.47 + aPhaseOffset * 1.31) * 0.45;
    pos += vec3(dx, dy, dz) * amp;

    vec4  mvPos  = modelViewMatrix * vec4(pos, 1.0);
    float ptSize = (13.2 + uPulse * 5.5) * (400.0 / max(uCameraDistance, 50.0));
    gl_PointSize = clamp(ptSize, 2.0, 24.0);
    gl_Position  = projectionMatrix * mvPos;
  }`;

export const NEXUS_NODE_FRAG = `
  uniform float uTime;
  varying float vCharType;
  varying float vPulse;
  varying vec3  vColor;
  varying float vPhaseOffset;
  varying float vDegree;

  float sdfZero(vec2 uv) {
    vec2  oval  = vec2(uv.x * 0.85, uv.y);
    float ro    = length(oval);
    return 1.0 - abs(ro - 0.55) / 0.20;
  }
  float sdfOne(vec2 uv) {
    float bar   = 1.0 - abs(uv.x) / 0.16;
    float cap   = step(-0.72, uv.y) * step(uv.y, 0.72);
    float serif = 1.0 - length(vec2(uv.x + 0.22, uv.y - 0.68)) / 0.18;
    return max(bar * cap, serif);
  }
  float sdfX(vec2 uv) {
    float d1  = 1.0 - abs(uv.x - uv.y) / 0.20;
    float d2  = 1.0 - abs(uv.x + uv.y) / 0.20;
    float cap = step(-0.72, uv.x) * step(uv.x, 0.72) * step(-0.72, uv.y) * step(uv.y, 0.72);
    return max(d1, d2) * cap;
  }
  float sdfF(vec2 uv) {
    float bar  = 1.0 - abs(uv.x + 0.30) / 0.18;
    float cap  = step(-0.72, uv.y) * step(uv.y, 0.72);
    float top  = 1.0 - abs(uv.y - 0.68) / 0.14;
    float topH = step(-0.30, uv.x) * step(uv.x, 0.50);
    float mid  = 1.0 - abs(uv.y - 0.10) / 0.14;
    float midH = step(-0.30, uv.x) * step(uv.x, 0.30);
    return max(bar * cap, max(top * topH, mid * midH));
  }

  void main() {
    vec2  uv   = (gl_PointCoord - 0.5) * 2.0;
    float dist = length(uv);
    if (dist > 1.0) discard;
    float sdf;
    if      (vCharType < 0.17) sdf = sdfZero(uv);
    else if (vCharType < 0.50) sdf = sdfOne(uv);
    else if (vCharType < 0.83) sdf = sdfX(uv);
    else                       sdf = sdfF(uv);
    float alpha = clamp(sdf * 4.0, 0.0, 1.0);
    if (alpha < 0.05) discard;
    // Twinkle rate + depth driven by connectivity — hubs flicker faster and deeper
    float flickerFreq = 3.0 + vDegree * 0.7;
    float flickerAmp  = 0.20 + min(vDegree, 25.0) * 0.014;
    float flicker = (1.0 - flickerAmp) + flickerAmp * sin(uTime * flickerFreq + vPhaseOffset * 12.0);
    alpha *= flicker;
    float whiteHot = smoothstep(0.45, 0.95, vPulse);
    vec3  col      = mix(vColor, vec3(1.0, 0.97, 0.85), whiteHot);
    float edgeFade = 1.0 - smoothstep(0.65, 1.0, dist);
    float bright   = 0.85 + whiteHot * 0.15;
    gl_FragColor   = vec4(col * bright, alpha * edgeFade * (0.175 + whiteHot * 0.35));
  }`;
