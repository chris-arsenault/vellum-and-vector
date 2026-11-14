import initialize from "../dist/atlas_browser.js";
import type { MainModule } from "../dist/atlas_browser.js";

export * from "../dist/atlas_browser.js";

let ready: Promise<MainModule> | undefined;

/** Initialize once in the worker that owns this browser workspace. */
export function initializeEngine() {
  return (ready ??= initialize());
}
