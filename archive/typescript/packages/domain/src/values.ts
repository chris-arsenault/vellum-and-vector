import { Band } from "./lattice/band";
import { Coverage } from "./lattice/coverage";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
 * Structural equality of records. Bands compare by their samples and coverages are storage
 * accounting, so a copy-on-write snapshot of an unchanged grid is the same value.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const stored = sameStorage(a, b);
  if (stored !== undefined) return stored;
  if (Array.isArray(a))
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  if (!record(a) || !record(b)) return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>,
    keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  );
}
/** Equality of sampled storage, or undefined when neither side is a band or coverage. */
function sameStorage(a: unknown, b: unknown) {
  if (a instanceof Band || b instanceof Band)
    return a instanceof Band && b instanceof Band && sameSamples(a, b);
  if (a instanceof Coverage || b instanceof Coverage)
    return a instanceof Coverage && b instanceof Coverage;
  return undefined;
}
function sameSamples(a: Band, b: Band) {
  if (a.length !== b.length || a.type !== b.type) return false;
  for (let i = 0; i < a.length; i++) if (a.get(i) !== b.get(i)) return false;
  return true;
}
