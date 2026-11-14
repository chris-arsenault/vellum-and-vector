/** Compare plain creator form values when describing changes in the review panel. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a))
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  if (!record(a) || !record(b)) return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  );
}
function record(value: unknown) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reject an invalid creator-form edit before replacing its current values. */
export function requireFormValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
