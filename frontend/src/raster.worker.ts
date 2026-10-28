import { tileProcessor } from "./tileProcessor";
import type { TileMessage } from "./tileProtocol";
import { openRenderResources } from "./renderResources";
import { WorkspaceClient } from "./WorkspaceClient";

const process = tileProcessor();
let resources: ReturnType<typeof openRenderResources> | undefined;
let workspace: WorkspaceClient | undefined;
let port: MessagePort | undefined;
const opened = new Map<number, () => void>();
const failures = new Map<number, string>();
let pending = Promise.resolve();
let closing = false;
const queue: Extract<TileMessage, { kind: "tile" }>[] = [];
let scheduled = false;
function next() {
  const message = queue.shift();
  if (message && !closing) {
    const failure = failures.get(message.id);
    const reply = failure ? { request: message.request, error: failure } : process(message)!;
    self.postMessage(reply, { transfer: "values" in reply ? [reply.values.buffer] : [] });
  }
  scheduled = queue.length > 0 && !closing;
  if (scheduled) setTimeout(next, 0);
}
async function register(message: Extract<TileMessage, { kind: "resourceRaster" }>) {
  try {
    const reader = await (resources ??= openRenderResources(workspace));
    const loaded = await reader.load(message.raster);
    // Load before closing a previous registration so shared inputs never drop to zero users.
    opened.get(message.id)?.();
    opened.set(message.id, loaded.close);
    failures.delete(message.id);
    process({ kind: "loadedRaster", id: message.id, raster: loaded.raster });
  } catch (error) {
    failures.set(message.id, error instanceof Error ? error.message : String(error));
  }
}
function release(message: Extract<TileMessage, { kind: "release" }>) {
  opened.get(message.id)?.();
  opened.delete(message.id);
  failures.delete(message.id);
  for (let index = queue.length - 1; index >= 0; index--)
    if (queue[index].id === message.id) queue.splice(index, 1);
  process(message);
}
async function receive(message: TileMessage) {
  if (message.kind === "close") {
    queue.length = 0;
    try {
      if (resources) await (await resources).close();
    } finally {
      port?.close();
      self.postMessage({ kind: "closed" });
      self.close();
    }
  } else if (closing) return;
  else if (message.kind === "connect") {
    port = message.port;
    workspace = new WorkspaceClient(port);
  } else if (message.kind === "resourceRaster") await register(message);
  else if (message.kind === "tile") {
    queue.push(message);
    if (!scheduled) {
      scheduled = true;
      setTimeout(next, 0);
    }
  } else if (message.kind === "release") release(message);
  else process(message);
}
self.addEventListener("message", (event: MessageEvent<TileMessage>) => {
  const message = event.data;
  if (message.kind === "close") closing = true;
  if (message.kind === "cancel") {
    const cancel = () => {
      const index = queue.findIndex((item) => item.request === message.request);
      if (index >= 0) queue.splice(index, 1);
    };
    cancel();
    pending = pending.then(cancel);
  } else pending = pending.then(() => receive(message));
});
