import type { WorkspaceChange } from "@atlas/domain";

export type Change = "world" | "jobs" | "templates" | WorkspaceChange;
const listeners = new Set<(change: Change) => void>();
export function subscribe(listener: (change: Change) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function changed(change: Change = "world") {
  for (const listener of listeners) listener(change);
}
