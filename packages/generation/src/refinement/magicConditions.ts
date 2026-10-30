import { gridPosition, type MagicCondition, type MagicFeatureRule } from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import { clamp, type RefinementState } from "./state";

const nativeRatios = new Set([
  "fracture",
  "moisture",
  "ice",
  "geothermal",
  "quickening",
  "stillness",
  "upwelling",
]);
export function magicValue(
  state: RefinementState,
  owner: string,
  key: string,
  i: number,
  salt = 0
) {
  const g = state.surface;
  if (!key.includes(":")) return localValue(state, owner, key, i, salt);
  if (key.startsWith("system:")) return readBand(state, `magic:${key.slice(7)}:intensity`, i);
  if (key.startsWith("stock:"))
    return readBand(state, `magic:${owner}:${key}`, i) / g.measures.get(i);
  if (key.startsWith("source:"))
    return readBand(state, `magic:${owner}:origin:${key.slice(7)}:source`, i);
  return 0;
}
const readBand = (state: RefinementState, key: string, i: number) =>
  state.surface.channels[key]?.get(i) ?? 0;
function localValue(state: RefinementState, owner: string, key: string, i: number, salt: number) {
  const g = state.surface;
  if (["noise", "scatter"].includes(key)) {
    const p = gridPosition(g, i);
    return (
      (fractalNoise(
        p.x,
        p.y,
        state.input.seed ^ salt,
        Math.max(state.parentSpan / 2, (g.scope.resolution ?? 1000) * 4),
        2
      ) +
        1) /
      2
    );
  }
  if (key === "river") return g.channels.riverOrder.get(i);
  if (key === "temperature") return g.channels.temperature.get(i) * 10 + 300;
  const value = g.channels[`magic:${owner}:${key}`]?.get(i) ?? g.channels[key]?.get(i) ?? 0;
  return nativeRatios.has(key) ? value * 1000 : value;
}
function passes(state: RefinementState, owner: string, test: MagicCondition, i: number) {
  const value = magicValue(state, owner, test.field, i, test.salt);
  if (test.values && !test.values.includes(value)) return false;
  return value >= (test.min ?? -Infinity) && value <= (test.max ?? Infinity);
}
export function matchesMagic(
  state: RefinementState,
  owner: string,
  groups: MagicCondition[][],
  i: number
) {
  return groups.some((group) => group.every((test) => passes(state, owner, test, i)));
}
export function magicShare(
  state: RefinementState,
  owner: string,
  rule: MagicFeatureRule,
  i: number
) {
  if (!matchesMagic(state, owner, [...rule.seeds, ...(rule.retains ?? [])], i)) return 0;
  const c = rule.coverage;
  return c ? clamp((magicValue(state, owner, c.field, i) - c.floor) / (c.full - c.floor)) : 1;
}
