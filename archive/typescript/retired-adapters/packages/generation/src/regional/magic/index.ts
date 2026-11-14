import { magicRockFeedback } from "../../world/magicFeedback";
import { standaloneHeat } from "../../world/atlasForcing";
import {
  publishCurrentMagic,
  evaluateSocietyMagic,
  initializeMagicWorkspace,
  reactMagicMaterial,
} from "../../world/magicProcesses";
import { inheritMagicChannel } from "../../world/magicInheritance";
import { magicKey } from "../../world/magicState";
import { respondOrganicMaterial } from "../../world/magicGroundwater";
import { seedDoors } from "./writes";
import type { MapProcessContext } from "../../process";
import type { RegionalState } from "../state";
import { executeMapOperation, processOwner } from "../../processTraits";
import { readOperation, runOperation } from "../../processOperation";
import { coastalForcing } from "../../world/coastalForcing";
import { nativeContext } from "../../world/context";

/** Captured material, fluids and maintained ground initialize the same current-field owners. */
export function prepareMagic(state: RegionalState) {
  const enabled = state.regional.input.domains.includes("magic");
  runOperation(processOwner(state), initializeMagicWorkspace, { state, enabled });
  const magic = state.physical.magic!;
  for (const field of magic.fields) {
    if (!field.definition.enabled) continue;
    inheritMagicChannel(state, magicKey(field, "intensity"), field.intensity);
    if (field.definition.origins.some((origin) => origin.source === "pairing"))
      seedDoors(state, field);
  }
  if (enabled) rememberAppliedForcing(state);
  return magic;
}

/** Seed replacement from captured applied values, not a reevaluation at the child's scale. */
function rememberAppliedForcing(state: RegionalState) {
  const { map, magic } = state.physical;
  magic!.fog.copyFrom(map.FogForcing);
  for (let i = 0; i < map.mesh.count; i++)
    magic!.heat.set(i, map.ExternalHeatForcing.get(i) - standaloneHeat(state, i));
}

/** Current media and inventories determine response; refresh supplies nothing and alters no ground. */
export function respondMagic(state: RegionalState, context: MapProcessContext) {
  if (!state.physical.magic || !state.regional.input.domains.includes("magic")) return;
  executeMapOperation(evaluateSocietyMagic, state, context);
  readOperation(state.physical.map, coastalForcing, {
    map: state.physical.map,
    context: nativeContext(state, context, 0),
  });
}

/** One local material response after the scheduled field refresh, without source renewal. */
export function reactRegionalMagic(state: RegionalState, exposure: number) {
  if (!state.physical.magic || !state.regional.input.domains.includes("magic")) return;
  magicRockFeedback(state);
  runOperation(processOwner(state), reactMagicMaterial, {
    state,
    response: {
      seed: state.regional.input.seed,
      phase: state.physical.map.CompletedEpochCount,
      span: exposure,
    },
  });
}

/** Consume the burial and pickup made by local ecological development, never by refresh. */
export function respondRegionalOrganic(state: RegionalState) {
  if (state.physical.magic && state.regional.input.domains.includes("magic"))
    respondOrganicMaterial(state);
}

/** The present classes and their projection to the surface, once after local development. */
export function mapMagic(state: RegionalState, context: MapProcessContext) {
  if (!state.physical.magic) return;
  executeMapOperation(publishCurrentMagic, state, context);
}
