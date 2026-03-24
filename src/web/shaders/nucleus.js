// shaders/nucleus.js — GLSL shaders for the nucleus stellar core

export const NUCLEUS_VERT = `
  uniform float uTime;
  uniform float uRadius;
  uniform float uCameraDistance;
  attribute float aPhaseOffset;
  attribute float aDriftFreq;
  attribute float aDriftAmp;
  attribute float aZone;
  attribute float aCharType;
  attribute float aInner;
  varying float vZone;
  varying float vAlpha;
  varying float vCharType;
  varying float vPhaseOffset;

  void main() {
    vec3  pos = position;
    float t   = uTime;
    float f   = aDriftFreq;
    float ph  = aPhaseOffset;

    // Independent per-axis multi-harmonic drift.
    // Incommensurable frequencies (1.0, 1.31, 0.79, 2.17, 1.73, 0.53) mean
    // all three axes can never be simultaneously zero → motion never stops.
    float dx = sin(t * f        + ph)            + sin(t * f * 2.17 + ph * 0.73) * 0.45;
    float dy = cos(t * f * 1.31 + ph * 1.07)    + cos(t * f * 1.73 + ph * 0.91) * 0.45;
    float dz = sin(t * f * 0.79 + ph * 0.83)    + sin(t * f * 1.47 + ph * 1.31) * 0.45;
    pos += vec3(dx, dy, dz) * aDriftAmp;

    // Slow global breathe
    pos *= 1.0 + 0.04 * sin(t * 0.6 + ph);

    vZone        = aZone;
    vCharType    = aCharType;
    vPhaseOffset = aPhaseOffset;
    vAlpha       = 0.55 + 0.45 * aInner;
    vec4 mvPos   = modelViewMatrix * vec4(pos, 1.0);
    gl_Position  = projectionMatrix * mvPos;
    float szBase = 4.0 + 3.0 * aInner;
    gl_PointSize = clamp(szBase * (400.0 / max(uCameraDistance, 50.0)), 1.5, 18.0);
  }`;

export const NUCLEUS_FRAG = `
  uniform float uTime;
  varying float vZone;
  varying float vAlpha;
  varying float vCharType;
  varying float vPhaseOffset;

  void main() {
    vec2  uv   = (gl_PointCoord - 0.5) * 2.0;
    float dist = length(uv);
    if (dist > 1.0) discard;
    // Zone colour — functional areas
    vec3 col;
    if      (vZone < 0.5) col = vec3(0.25, 0.60, 1.00); // blue   — API / HTTP
    else if (vZone < 1.5) col = vec3(0.10, 0.85, 0.85); // cyan   — data / models
    else if (vZone < 2.5) col = vec3(0.65, 0.35, 1.00); // violet — core engine
    else                  col = vec3(0.25, 0.90, 0.45); // green  — trade / signals
    // Soft radial glow — no SDF characters
    float glow  = 1.0 - smoothstep(0.0, 1.0, dist);
    float alpha = glow * glow;
    if (alpha < 0.02) discard;
    // Per-point flicker — heat-haze shimmer
    float flicker = 0.6 + 0.4 * sin(uTime * 7.0 + vPhaseOffset * 13.0);
    alpha *= flicker * vAlpha;
    gl_FragColor = vec4(col, alpha);
  }`;
