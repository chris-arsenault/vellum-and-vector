import { distance, neighborsOf } from "./lattice";
import { clamp, type RegionalState } from "./state";

/** Macro gradients at which ground is plain and at which it is fully rugged, and what a plain keeps. */
const plainGradient = 0.002,
  ruggedGradient = 0.02,
  plainDetail = 0.1;
/**
 * How much of the network's detail the ground shows, from how the parent's country falls. Low
 * or high, level country is plain or plateau: streams cross it without cutting it into ridges.
 * Country falling hard is dissected in full. The macro surface is the parent's either way.
 */
export function ruggedness(state: RegionalState, macro: Float64Array) {
  const mesh = state.physical.map.mesh,
    { sea } = state.regional.network!,
    rugged = new Float64Array(macro.length),
    around = new Int32Array(mesh.stride);
  for (let i = 0; i < macro.length; i++) {
    const m = neighborsOf(mesh, i, around);
    let fall = 0;
    for (let k = 0; k < m; k++) {
      const j = around[k];
      if (!sea[j]) fall = Math.max(fall, Math.abs(macro[j] - macro[i]) / distance(mesh, i, j));
    }
    const t = clamp((fall - plainGradient) / (ruggedGradient - plainGradient));
    rugged[i] = plainDetail + (1 - plainDetail) * t * t * (3 - 2 * t);
  }
  return rugged;
}
