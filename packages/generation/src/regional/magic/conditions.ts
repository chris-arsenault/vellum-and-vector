import { gridPosition, type MagicCondition, type MagicFeatureRule } from "@atlas/domain";
import { fractalNoise } from "../../canonry/noise";
import { clamp, type RegionalState } from "../state";

const nativeRatios = new Set([
  "fracture",
  "moisture",
  "ice",
  "geothermal",
  "quickening",
  "stillness",
  "upwelling",
]);
export function magicValue(state: RegionalState, owner: string, key: string, i: number, salt = 0) {
  const g = state.surface;
  if (!key.includes(":")) return localValue(state, owner, key, i, salt);
  if (key.startsWith("system:")) return readBand(state, `magic:${key.slice(7)}:intensity`, i);
  if (key.startsWith("stock:"))
    return readBand(state, `magic:${owner}:${key}`, i) / g.measures.get(i);
  if (key.startsWith("source:"))
    return readBand(state, `magic:${owner}:origin:${key.slice(7)}:source`, i);
  return 0;
}
const readBand = (state: RegionalState, key: string, i: number) =>
  state.surface.channels[key]?.get(i) ?? 0;
/** The world's rule vocabulary for a located scatter: a seeded field in 0..1. */
function scatterValue(state: RegionalState, salt: number, i: number) {
  const g = state.surface,
    p = gridPosition(g, i);
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
function localValue(state: RegionalState, owner: string, key: string, i: number, salt: number) {
  const g = state.surface;
  if (["noise", "scatter"].includes(key)) return scatterValue(state, salt, i);
  if (key === "river") return g.channels.riverOrder?.get(i) ?? 0;
  if (key === "temperature") return g.channels.temperature.get(i) * 10 + 300;
  const own = g.channels[`magic:${owner}:${key}`],
    value = own ? own.get(i) : readBand(state, key, i);
  return nativeRatios.has(key) ? value * 1000 : value;
}
function passes(state: RegionalState, owner: string, test: MagicCondition, i: number) {
  const value = magicValue(state, owner, test.field, i, test.salt);
  if (test.values && !test.values.includes(value)) return false;
  return value >= (test.min ?? -Infinity) && value <= (test.max ?? Infinity);
}
export function matchesMagic(
  state: RegionalState,
  owner: string,
  groups: MagicCondition[][],
  i: number
) {
  return groups.some((group) => group.every((test) => passes(state, owner, test, i)));
}
export function magicShare(state: RegionalState, owner: string, rule: MagicFeatureRule, i: number) {
  if (!matchesMagic(state, owner, [...rule.seeds, ...(rule.retains ?? [])], i)) return 0;
  const c = rule.coverage;
  return c ? clamp((magicValue(state, owner, c.field, i) - c.floor) / (c.full - c.floor)) : 1;
}
