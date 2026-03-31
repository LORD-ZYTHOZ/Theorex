// src/rag/turbo-quant.ts
// TurboQuant: Johnson-Lindenstrauss projection + 1-bit sign quantization.
//
// Workflow:
//   full vector (768d float) → JL projection (768→256d) → 1-bit sign → 32 uint8 bytes
//
// The projection matrix is seeded (deterministic) so it can be regenerated
// identically on any machine. Store compressed codes in Postgres as bytea.

/** Dimensions */
export const FULL_DIM = 768;  // nomic-embed-text output dimension
export const PROJ_DIM = 256;  // JL target dimension

/** Default seed — override with TURBO_SEED env var */
export const TURBO_SEED = 42;

/**
 * Minimal seeded xorshift32 PRNG.
 * Returns a stateful next() function that yields uint32 values.
 */
function makeXorshift32(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 1; // xorshift32 must not start at 0
  return function next(): number {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0; // unsigned 32-bit
  };
}

/**
 * Box-Muller transform: convert two uniform [0,1) values to N(0,1).
 * Returns [z0, z1].
 */
function boxMuller(u1: number, u2: number): [number, number] {
  const mag = Math.sqrt(-2.0 * Math.log(u1 + 1e-10));
  const z0 = mag * Math.cos(2 * Math.PI * u2);
  const z1 = mag * Math.sin(2 * Math.PI * u2);
  return [z0, z1];
}

/**
 * Generate the JL projection matrix.
 * Shape: PROJ_DIM × FULL_DIM (row-major), entries drawn from N(0, 1/PROJ_DIM).
 * Seeded with TURBO_SEED env var (default: 42) for determinism.
 */
export function buildProjectionMatrix(seed?: number): Float32Array {
  const resolvedSeed = seed ?? parseInt(process.env['TURBO_SEED'] ?? String(TURBO_SEED), 10);
  const rng = makeXorshift32(resolvedSeed);
  const scale = 1.0 / Math.sqrt(PROJ_DIM);
  const total = PROJ_DIM * FULL_DIM;
  const matrix = new Float32Array(total);

  // Box-Muller needs pairs; generate total values (even total guaranteed: 256*768=196608)
  for (let i = 0; i < total; i += 2) {
    const u1 = (rng() + 1) / 0x1_0000_0001; // map uint32 → (0, 1]
    const u2 = (rng() + 1) / 0x1_0000_0001;
    const [z0, z1] = boxMuller(u1, u2);
    matrix[i] = z0 * scale;
    if (i + 1 < total) matrix[i + 1] = z1 * scale;
  }

  return matrix;
}

/**
 * Project a 768d vector to 256d using the projection matrix.
 * matrix is row-major PROJ_DIM × FULL_DIM.
 */
export function project(vec: Float32Array, matrix: Float32Array): Float32Array {
  const out = new Float32Array(PROJ_DIM);
  for (let row = 0; row < PROJ_DIM; row++) {
    let dot = 0;
    const offset = row * FULL_DIM;
    for (let col = 0; col < FULL_DIM; col++) {
      dot += (matrix[offset + col] ?? 0) * (vec[col] ?? 0);
    }
    out[row] = dot;
  }
  return out;
}

/**
 * 1-bit sign quantization: sign(x) → bit.
 * Returns 32 bytes (256 bits). Positive → 1, zero/negative → 0.
 */
export function quantize(projected: Float32Array): Uint8Array {
  const bytes = new Uint8Array(PROJ_DIM / 8); // 32 bytes
  for (let i = 0; i < PROJ_DIM; i++) {
    if ((projected[i] ?? 0) > 0) {
      bytes[i >> 3] |= 1 << (7 - (i & 7));
    }
  }
  return bytes;
}

/**
 * Combined: full vector → compressed 32 bytes.
 */
export function compress(vec: Float32Array, matrix: Float32Array): Uint8Array {
  return quantize(project(vec, matrix));
}

/**
 * Hamming distance between two 32-byte compressed codes.
 * Returns integer 0–256.
 */
export function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let xor = ((a[i] ?? 0) ^ (b[i] ?? 0)) >>> 0;
    // Brian Kernighan popcount
    while (xor !== 0) {
      xor &= xor - 1;
      dist++;
    }
  }
  return dist;
}
