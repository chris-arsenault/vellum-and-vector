import { DomainError } from "@atlas/domain";

export function workingStorage<T>(
  kind: "feature" | "network" | "contour",
  operation: "read" | "write",
  work: () => T
): T {
  try {
    return work();
  } catch (error) {
    throw new DomainError(
      `${kind}_${operation}`,
      `Working geography could not ${operation} local storage: ${String(error)}`
    );
  }
}
