import { type ParameterDefinitions, type Value } from "./schemas";
import type { Layer } from "./model";
/**
 * The nearest storable value: non-finite numbers become null, undefined and functions are
 * omitted, maps, sets, typed arrays and other objects become plain records or lists. Each
 * change is recorded against its attribute path.
 */
export declare function storableValue(
  value: unknown,
  path: string,
  problems: string[]
): Value | undefined;
/** An attribute record, or an error naming its owner and every value that cannot be stored. */
export declare function requireValueRecord(input: unknown, owner: string): Record<string, Value>;
export declare function layerAttributeDefinitions(
  input: Record<string, unknown>
): ParameterDefinitions;
export declare function validateLayerAttributes(
  layer: Layer,
  input: Record<string, unknown>,
  owner?: string
): Record<string, Value>;
export declare function validateLayerChange(
  previous: Layer | undefined,
  next: Layer,
  features: Iterable<{
    id?: string;
    kind?: string;
    attributes: Record<string, unknown>;
    detail: Record<
      string,
      {
        attributes: Record<string, unknown> | null;
      }
    >;
  }>,
  materializedFields: number
): void;
