import type { GenerationState, MapProcessContext } from "../process";
import type { ProcessBehavior } from "../processTraits";
import { requireThat } from "@atlas/domain";

type Operation = (state: GenerationState, context: MapProcessContext) => void | Promise<void>;
/** Material traits check the common budget even when several mechanisms supply it. */
export function nativeBehavior(movesMaterial: boolean, operation: Operation): ProcessBehavior {
  return movesMaterial
    ? { kind: "material-transformation", transform: operation, balance: materialBudget }
    : { kind: "model-pass", applyPass: operation };
}
function materialBudget(state: GenerationState) {
  const map = state.physical!;
  const {
    SedimentProducedTotal: produced,
    SedimentDepositedTotal: deposited,
    SedimentExportedTotal: exported,
  } = map.map;
  requireThat(
    [produced, deposited, exported].every((value) => Number.isFinite(value) && value >= 0) &&
      deposited + exported <= produced + Math.max(0.001, produced * 1e-9),
    "material_budget",
    "Material transformations retain the shared sediment budget."
  );
}
