import type { GenerationState, MapProcessContext } from "../process";
import type { ProcessBehavior } from "../processTraits";

type Operation = (state: GenerationState, context: MapProcessContext) => void | Promise<void>;
/** Material operations use the same completion boundary as other native operations. */
export function nativeBehavior(movesMaterial: boolean, operation: Operation): ProcessBehavior {
  return movesMaterial
    ? { kind: "material-transformation", transform: operation }
    : { kind: "model-pass", applyPass: operation };
}
