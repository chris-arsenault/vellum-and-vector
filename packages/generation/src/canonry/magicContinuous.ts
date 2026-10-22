import { prepareSampleCoefficients, prepareAdaptiveCoefficients } from "@atlas/domain";
import type { GenerationState } from "../process";
import { magicChannels, magicFieldDefinitions } from "./magicFieldDefinitions";
import { physicalSupport } from "./physicalSupport";
import { preparePhysicalChannels, type PhysicalArrayName } from "./continuousState";
import { recordMagicOccurrences } from "./magicOccurrences";

const feedbackWrites: Record<string, PhysicalArrayName[]> = {
  climate: ["Temperature", "IceThickness", "ExternalHeatForcing"],
  rocks: ["RockResistance"],
  coast: ["ExternalCoastalForcing"],
};
export function prepareMagicFields(state: GenerationState, phase: string) {
  const work = state.physical!;
  preparePhysicalChannels(work.map, feedbackWrites[phase] ?? []);
  if (["project", "classify", "rocks"].includes(phase)) return;
  const support = physicalSupport(work.map.mesh);
  for (const field of work.magic?.fields ?? []) {
    field.coefficients ??= {};
    for (const name of magicChannels) {
      if (magicFieldDefinitions[name].quantity !== "intensive") continue;
      if (work.map.mesh.topology) {
        const mesh = work.map.mesh;
        const next = prepareAdaptiveCoefficients(
          mesh.topology!,
          (leaf) => field[name][mesh.leafToCell[leaf]]
        );
        field.adaptive ??= {};
        if (field.adaptive[name]?.topology === mesh.topology)
          field.adaptive[name]!.cells = next.cells;
        else field.adaptive[name] = next;
        delete field.coefficients[name];
      } else {
        const next = prepareSampleCoefficients(support, field[name]);
        const previous = field.coefficients[name];
        if (previous?.dx.length === next.dx.length) {
          previous.dx.set(next.dx);
          previous.dy.set(next.dy);
          previous.affine = next.affine;
        } else field.coefficients[name] = next;
        if (field.adaptive) delete field.adaptive[name];
      }
    }
    recordMagicOccurrences(state, field);
  }
}
