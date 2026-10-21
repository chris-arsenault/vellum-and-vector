/** Node test bridge around the production browser worker, in a separate realm. */
import { parentPort } from "node:worker_threads";
import { atlasGenerationModules } from "../atlasModules";
import { statefulInventoryModule } from "./statefulModule";

if (!parentPort) throw new Error("Start this fixture in a worker thread.");
const port = parentPort;
const bridge: {
  onmessage: ((event: MessageEvent) => Promise<void>) | null;
  postMessage(message: unknown): void;
} = {
  onmessage: null,
  postMessage: (message) => port.postMessage(message),
};
Object.defineProperty(globalThis, "self", { value: bridge });
atlasGenerationModules.register(statefulInventoryModule);
await import("../../../../frontend/src/generation.worker");
port.on("message", (data: unknown) => {
  if (!bridge.onmessage) throw new Error("Production worker handler was not installed.");
  void bridge.onmessage({ data } as MessageEvent);
});
