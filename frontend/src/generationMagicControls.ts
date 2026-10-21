import type { MagicSystem } from "@atlas/domain";

type Parameter = keyof MagicSystem["parameters"];
type Controls = Pick<MagicSystem, "source" | "propagation" | "effects">;

const sourceControls: Record<MagicSystem["source"], Parameter[]> = {
  geothermal: ["maximumSources", "sourceThreshold", "sourceSpacing"],
  cold: ["baseInput"],
  "deep-ocean": [],
  placed: [],
};
const propagationControls: Record<MagicSystem["propagation"], Parameter[]> = {
  fracture: ["baseCost", "conductanceDivisor"],
  "cold-drainage": ["logScale", "iceRetention", "coldRetentionDistance", "accumulationArea"],
  "ocean-rays": [
    "rayCount",
    "rayDistance",
    "coastalRayDistance",
    "wakeDistance",
    "beamWidth",
    "coastalSources",
    "coastalSourceDistance",
    "wakeSources",
  ],
  radial: [],
};
/** Source selection, propagation and coastal response read independent parameters. */
export function magicControlKeys(system: Controls): Parameter[] {
  const keys = [...sourceControls[system.source], ...propagationControls[system.propagation]];
  // The deep-ocean source's beam width supplies its radius to radial propagation.
  if (system.source === "deep-ocean" && system.propagation === "radial") keys.push("beamWidth");
  if (system.effects.coastalForcing !== 0)
    keys.push("coastalThreshold", "waveAmplification", "currentAmplification");
  keys.push("featureNoiseScale");
  return [...new Set(keys)];
}
