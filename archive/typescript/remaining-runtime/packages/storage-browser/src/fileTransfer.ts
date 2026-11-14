import { DomainError, requireThat } from "@atlas/domain";

/** File APIs may complete only part of a request; a zero-byte transfer cannot advance it. */
export function transferFile(
  operation: "read" | "write",
  bytes: Uint8Array,
  offset: number,
  transfer: (remaining: Uint8Array, at: number) => number
) {
  let completed = 0;
  try {
    while (completed < bytes.byteLength) {
      const count = transfer(bytes.subarray(completed), offset + completed);
      requireThat(
        Number.isSafeInteger(count) && count > 0 && count <= bytes.byteLength - completed,
        `numerical_${operation}`,
        `Local storage ${operation} stopped after ${completed} of ${bytes.byteLength} bytes at offset ${offset}.`
      );
      completed += count;
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      `numerical_${operation}`,
      `Local storage ${operation} failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return completed;
}
