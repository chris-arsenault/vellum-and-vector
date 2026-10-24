// Canonry PhysicalNoise.cs, commit 0f62584c114863ffadeb5e29e021f5fce6b37a61.
import { lerp } from "./math";
import type { PhysicalMesh } from "./mesh";

const goldenAngle = Number("2.39996322972865332");
const rotationCos = Math.cos(goldenAngle);
const rotationSin = Math.sin(goldenAngle);
// High word of an unsigned 32x32 product. Sixteen-bit partial products stay
// exact within JavaScript's integer precision; Math.imul supplies the low word.
function highProduct(a: number, b: number): number {
  const al = a & 65535,
    ah = a >>> 16,
    bl = b & 65535,
    bh = b >>> 16;
  const cross = ((al * bl) >>> 16) + ah * bl + al * bh;
  return (ah * bh + Math.floor(cross / 65536)) >>> 0;
}

export function hashUnit(salt: number, x: number, y: number): number {
  const initialLow = (y >>> 0) + (Math.imul(salt, 0x7f4a7c15) >>> 0);
  let high =
    ((x >>> 0) +
      highProduct(salt, 0x7f4a7c15) +
      (Math.imul(salt, 0x9e3779b9) >>> 0) +
      Math.floor(initialLow / 4294967296)) >>>
    0;
  let low = initialLow >>> 0;
  low ^= (high << 2) | (low >>> 30);
  high ^= high >>> 30;
  let nextHigh =
    (Math.imul(high, 0x1ce4e5b9) + Math.imul(low, 0xbf58476d) + highProduct(low, 0x1ce4e5b9)) >>> 0;
  low = Math.imul(low, 0x1ce4e5b9) >>> 0;
  high = nextHigh;
  low ^= (high << 5) | (low >>> 27);
  high ^= high >>> 27;
  nextHigh =
    (Math.imul(high, 0x133111eb) + Math.imul(low, 0x94d049bb) + highProduct(low, 0x133111eb)) >>> 0;
  low = Math.imul(low, 0x133111eb) >>> 0;
  high = nextHigh;
  low ^= (high << 1) | (low >>> 31);
  high = (high ^ (high >>> 31)) >>> 0;
  return (high * 2097152 + (low >>> 11)) / 9007199254740992;
}
export const hashSigned = (salt: number, x: number, y: number) => hashUnit(salt, x, y) * 2 - 1;
function valueNoise(x: number, y: number, salt: number): number {
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const smooth = (v: number) => v * v * (3 - 2 * v);
  const tx = smooth(x - x0),
    ty = smooth(y - y0);
  return lerp(
    lerp(hashSigned(salt, x0, y0), hashSigned(salt, x0 + 1, y0), tx),
    lerp(hashSigned(salt, x0, y0 + 1), hashSigned(salt, x0 + 1, y0 + 1), tx),
    ty
  );
}
export function fractalNoise(
  x: number,
  y: number,
  salt: number,
  scale: number,
  octaves: number
): number {
  let amplitude = 1,
    total = 0,
    value = 0,
    cos = 1,
    sin = 0;
  for (let octave = 0; octave < octaves; octave++) {
    value +=
      valueNoise(
        (x * cos - y * sin) / scale,
        (x * sin + y * cos) / scale,
        (salt + octave * 7919) | 0
      ) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    scale *= 0.5;
    const nextCos = cos * rotationCos - sin * rotationSin;
    sin = cos * rotationSin + sin * rotationCos;
    cos = nextCos;
  }
  return value / total;
}
export const unitNoise = (x: number, y: number, salt: number, scale: number, octaves: number) =>
  (fractalNoise(x, y, salt, scale, octaves) + 1) * 0.5;

/** Blend translated noise charts with matching endpoint derivatives at the world seam. */
export function meshNoise(
  mesh: PhysicalMesh,
  x: number,
  y: number,
  salt: number,
  scale: number,
  octaves: number
) {
  const width = mesh.periodic?.width;
  if (!width) return fractalNoise(x, y, salt, scale, octaves);
  if (mesh.periodic?.poles) {
    const height = mesh.bounds[3] - mesh.bounds[1],
      radius = Math.sqrt((width * height) / (4 * Math.PI));
    const latitude = Math.PI * Math.max(-0.5, Math.min(0.5, y / height));
    const angle = (x * 2 * Math.PI) / width,
      ring = radius * Math.cos(latitude),
      z = radius * Math.sin(latitude);
    return (
      (fractalNoise(ring * Math.cos(angle), z, salt, scale, octaves) +
        fractalNoise(ring * Math.sin(angle), z, salt ^ 0x7d31, scale, octaves)) /
      2
    );
  }
  const phase = ((x % width) + width) % width,
    t = phase / width;
  return lerp(
    fractalNoise(phase, y, salt, scale, octaves),
    fractalNoise(phase - width, y, salt, scale, octaves),
    t * t * (3 - 2 * t)
  );
}
export const meshUnitNoise = (
  mesh: PhysicalMesh,
  x: number,
  y: number,
  salt: number,
  scale: number,
  octaves: number
) => (meshNoise(mesh, x, y, salt, scale, octaves) + 1) * 0.5;

/** World-space callers retain the same phase as the local full-world chart. */
export function meshWorldNoise(
  mesh: PhysicalMesh,
  x: number,
  y: number,
  salt: number,
  scale: number,
  octaves: number
) {
  return mesh.periodic
    ? meshNoise(mesh, x - mesh.origin[0], y - mesh.origin[1], salt, scale, octaves)
    : fractalNoise(x, y, salt, scale, octaves);
}
export const meshWorldUnitNoise = (
  mesh: PhysicalMesh,
  x: number,
  y: number,
  salt: number,
  scale: number,
  octaves: number
) => (meshWorldNoise(mesh, x, y, salt, scale, octaves) + 1) * 0.5;
