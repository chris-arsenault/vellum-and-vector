// Arconis: docs/architecture/subsystems.arconis#item=wasm_generator — worker that runs WASM generation beside the browser map store.
import { initializeEngine } from "@atlas/engine";
import { Decoder } from "cbor-x";
import { BrowserJobs } from "./browserJobs";
import type { AtlasCall, AtlasRequest, AtlasReply } from "./atlasContextProtocol";
import { cborOptions, type MapCall, type ContextCall } from "@atlas/transport";

const decoder = new Decoder(cborOptions);
let current: ReturnType<typeof open> | undefined;
async function open() {
  const engine = await initializeEngine();
  const maps = new engine.BrowserWorkspace();
  return {
    maps,
    jobs: new BrowserJobs(engine, maps),
    urls: new Map<string, { mediaType: string; url: string }>(),
  };
}
async function operate(operation: AtlasCall): Promise<unknown> {
  const workspace = await (current ??= open());
  const { maps, jobs, urls } = workspace;
  switch (operation.service) {
    case "open":
      return;
    case "close":
      await jobs.close();
      maps.free();
      for (const source of urls.values()) URL.revokeObjectURL(source.url);
      current = undefined;
      return;
    case "maps":
      return read(workspace, operation.call);
    case "library":
      return navigator.locks.request("atlas-saved-maps", () =>
        navigator.locks.request("atlas-context-mutation", { mode: "shared" }, () =>
          decoder.decode(maps.library(JSON.stringify(operation.call)))
        )
      );
    case "generation":
      return jobs.call(operation.call);
    case "contexts":
      return manage(workspace, operation.call);
    default:
      return decoder.decode(await geography(workspace, operation));
  }
}
/** Region navigation and real-scale editing run on the working map catalog. */
function geography(
  { maps }: Awaited<ReturnType<typeof open>>,
  operation: Extract<AtlasCall, { service: "navigation" | "editing" }>
) {
  const request = JSON.stringify(operation.call);
  return operation.service === "editing" ? maps.edit(request) : maps.navigate(request);
}
function manage(workspace: Awaited<ReturnType<typeof open>>, call: ContextCall) {
  if (call.method === "list") return JSON.parse(workspace.maps.contexts(JSON.stringify(call)));
  return navigator.locks.request("atlas-context-mutation", { ifAvailable: true }, (lock) => {
    if (!lock) throw new Error("Stop active browser generation jobs before removing stored data.");
    return JSON.parse(workspace.maps.contexts(JSON.stringify(call)));
  });
}
async function read(workspace: Awaited<ReturnType<typeof open>>, call: MapCall) {
  const request = JSON.stringify(call);
  if (call.method !== "source") return decoder.decode(workspace.maps.read(request));
  const cached = workspace.urls.get(request);
  if (cached) return cached;
  const asset = decoder.decode(workspace.maps.read(request)) as {
    mediaType: string;
    path: string[];
  };
  let directory = await navigator.storage.getDirectory();
  for (const part of asset.path.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  const handle = await directory.getFileHandle(asset.path.at(-1)!);
  const url = URL.createObjectURL(await handle.getFile());
  const source = { mediaType: asset.mediaType, url };
  workspace.urls.set(request, source);
  return source;
}
self.onmessage = (event: MessageEvent<AtlasRequest>) => {
  const { id, operation } = event.data;
  void operate(operation).then(
    (value) => self.postMessage({ id, value } satisfies AtlasReply),
    (error: unknown) =>
      self.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      } satisfies AtlasReply)
  );
};
