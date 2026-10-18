// CoastalDetailLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, units } from "./math";
import { fractalNoise } from "./noise";
import { rebuild } from "./surface";

function character(p: PhysicalProfile, margin: number) {
  const amplitudes = [
    0,
    p.CoastalDetailPassiveAmplitude,
    p.CoastalDetailConvergentAmplitude,
    p.CoastalDetailRiftedAmplitude,
    p.CoastalDetailTransformAmplitude,
  ];
  return {
    amplitude: amplitudes[margin] / 1000,
    scale: p.CoastalDetailScale * [1, 1, 0.55, 0.7, 1.3][margin],
    octaves: [4, 6, 6, 5, 4][margin],
    warp: (p.CoastalDetailWarp / 1000) * [0, 1, 1.6, 0.7, 0.35][margin],
    ridged: margin === 2 || margin === 3,
  };
}
function coastalNoise(
  map: PhysicalField,
  c: PhysicalContext,
  i: number,
  ch: ReturnType<typeof character>
) {
  const x = map.mesh.x[i],
    y = map.mesh.y[i],
    scale = Math.max(1, ch.scale * 1.7);
  const wx = fractalNoise(x, y, c.Seed ^ 0x51a3, scale, 3) * ch.warp;
  const wy = fractalNoise(x + 91.7, y - 43.1, c.Seed ^ 0x51a3, scale, 3) * ch.warp;
  const value = fractalNoise(x + wx, y + wy, c.Seed ^ 0x7c4b, ch.scale, ch.octaves);
  return ch.ridged ? 2 * Math.abs(value) - 1 : value;
}
export function coastalDetail(map: PhysicalField, c: PhysicalContext) {
  const band = units(c.Profile.CoastalDetailBand);
  if (band <= 0 || c.Profile.CoastalDetailStrength <= 0) return;
  for (let i = 0; i < map.mesh.count; i++) {
    const height = map.Elevation[i] - map.EffectiveSeaLevel;
    if (Math.abs(height) > band) continue;
    const ch = character(c.Profile, map.MarginCodes[i]);
    if (ch.amplitude <= 0) continue;
    const proximity = 1 - Math.abs(height) / band;
    const displacement = coastalNoise(map, c, i, ch) * ch.amplitude * proximity * proximity;
    const delta = units((displacement * c.Profile.CoastalDetailStrength) / 1000);
    if (delta === 0) continue;
    map.BedrockElevation[i] = clamp(
      map.BedrockElevation[i] + delta,
      units(-4000),
      units(4000) - map.SedimentThickness[i]
    );
    rebuild(map, i);
  }
}
