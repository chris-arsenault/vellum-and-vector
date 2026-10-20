import type { MagicFeatureRule } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { macroComponents, macroDistances, reconstructRegion } from "./macroRegions";
import { magicMatcher } from "./magicFeatures";

export function sourceRegion(
  state: GenerationState,
  field: MagicField,
  mask: Uint8Array,
  support: (i: number) => boolean,
  radius: number
) {
  const mesh = state.physical!.map.mesh,
    peaks = new Set<number>();
  for (const cells of macroComponents(mesh, (i) => Boolean(mask[i]))) {
    const area = cells.reduce((sum, i) => sum + mesh.areas[i], 0),
      x = cells.reduce((sum, i) => sum + mesh.x[i] * mesh.areas[i], 0) / area,
      y = cells.reduce((sum, i) => sum + mesh.y[i] * mesh.areas[i], 0) / area,
      score = (i: number) =>
        field.source[i] * 4 +
        field.intensity[i] +
        field.history[i] * 0.1 -
        Math.hypot(mesh.x[i] - x, mesh.y[i] - y) / radius,
      peak = cells.reduce((a, b) => (score(a) >= score(b) ? a : b));
    peaks.add(peak);
    for (const i of cells) {
      if (field.source[i] <= 0 || score(i) < score(peak) * 0.7) continue;
      if (
        [...peaks].every(
          (j) => Math.hypot(mesh.x[i] - mesh.x[j], mesh.y[i] - mesh.y[j]) > radius * 2
        )
      )
        peaks.add(i);
    }
  }
  const front = macroDistances(mesh, (i) => peaks.has(i), support, radius,
    sourceResistance(state, field));
  return {
    ...front,
    mask: Uint8Array.from(mask, (_, i) => Number(support(i) && front.distance[i] <= radius * 0.65)),
  };
}
function sourceResistance(state: GenerationState, field: MagicField) {
  const map = state.physical!.map, mesh = map.mesh;
  if (field.definition.propagation === "fracture") return (i: number, j: number) =>
    1.25 - Math.min(1, Math.min(map.FractureConductance[i], map.FractureConductance[j]) / 1000) * 0.5;
  if (field.definition.propagation === "cold-drainage") return (i: number, j: number) =>
    map.FlowTargets[i] === j || map.FlowTargets[j] === i ? 0.75 : 1.25;
  if (field.definition.propagation === "ocean-rays") return (i: number, j: number) => {
    const dx = mesh.x[j] - mesh.x[i], dy = mesh.y[j] - mesh.y[i],
      vx = map.OceanCurrentX[i], vy = map.OceanCurrentY[i],
      length = Math.hypot(dx, dy) * Math.hypot(vx, vy),
      alignment = length ? Math.abs((dx * vx + dy * vy) / length) : 0;
    return 1.25 - alignment * 0.5;
  };
  return () => 1;
}

export function frontRegion(
  state: GenerationState,
  mask: Uint8Array,
  support: (i: number) => boolean,
  radius: number
) {
  const mesh = state.physical!.map.mesh,
    carrier = reconstructRegion(mesh, mask, support, radius).mask,
    boundary = Uint8Array.from(carrier, (value, i) =>
      Number(
        value &&
          Array.from(
            { length: mesh.degree[i] },
            (_, edge) => mesh.neighbors[i * mesh.stride + edge]
          ).some((j) => j >= 0 && !carrier[j])
      )
    ),
    band = macroDistances(mesh, (i) => Boolean(boundary[i]), support, radius * 0.3),
    source = macroDistances(mesh, (i) => Boolean(mask[i]), support, radius);
  return {
    source: source.source,
    distance: source.distance,
    mask: Uint8Array.from(carrier, (value, i) => Number(value && band.distance[i] <= radius * 0.3)),
  };
}

export function interactionRegion(
  state: GenerationState,
  field: MagicField,
  rule: MagicFeatureRule,
  mask: Uint8Array,
  support: (i: number) => boolean,
  radius: number,
  seed: number
) {
  const contact = magicMatcher(state, field, rule.retains ?? rule.seeds, seed),
    overlap = (i: number) => support(i) && contact(i),
    region = reconstructRegion(state.physical!.map.mesh, mask, overlap, radius * 0.25),
    source = macroDistances(state.physical!.map.mesh, (i) => Boolean(mask[i]), overlap, radius);
  return { ...region, distance: source.distance, source: source.source };
}
