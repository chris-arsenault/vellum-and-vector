import type { GenerationState, MapProcessContext } from "../process";
import { mapCommand, mapQuery, mapWork, type MapOperation } from "../processTraits";
import type { NativeProcess } from "./sequence";
import { nativeContext } from "./context";

/** Native composition already declares the lifecycle of its executable children. */
export function nativeMapOperation(
  id: string,
  native: NativeProcess,
  apply: (state: GenerationState, context: MapProcessContext, exposure: number) => void
): MapOperation {
  switch (native.kind) {
    case "query":
      return mapQuery(id, (state, context) => apply(state, context, 0), []);
    case "initialize":
      return mapCommand(id, "initialize", (state, context) => apply(state, context, 0), []);
    case "event":
      return mapCommand(id, "event", (state, context) => apply(state, context, 0), []);
    case "work":
      return mapWork(
        id,
        (state, context) =>
          "regional" in state
            ? Number(context.parameters.workSpan)
            : nativeContext(state, context, 0).Span,
        apply,
        []
      );
    default:
      throw new Error(`Unsupported native operation ${native.id}: ${native.kind}`);
  }
}
