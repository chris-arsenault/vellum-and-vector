import type { Geometry } from "geojson";
import type { MapEngine } from "./mapEngine";
import { applyDrawingProducts, type DrawnMapInput } from "./drawnMap";
import { illustratedTerrain } from "./drawnTerrain";
import { illustratedFields } from "./drawnFields";
import type { IllustrationReply } from "./illustrationProtocol";
import { connectAtlasWorker } from "./connectAtlasWorker";

const workers = new WeakMap<
  MapEngine,
  { worker: Worker; ready: Promise<void>; sequence: number }
>();
/** Sampling belongs beside the resources. Only printable marks return to the map. */
export function renderIllustration(engine: MapEngine, input: DrawnMapInput, footprint: Geometry) {
  let owner = workers.get(engine);
  if (!owner) {
    const worker = new Worker(new URL("./illustration.worker.ts", import.meta.url), {
      type: "module",
    });
    const ready = connectAtlasWorker(worker);
    owner = { worker, ready, sequence: 0 };
    workers.set(engine, owner);
    engine.map.on("change:target", () => {
      if (!engine.map.getTarget()) {
        worker.onmessage = (event: MessageEvent<{ kind: string }>) => {
          if (event.data.kind === "closed") worker.terminate();
        };
        void ready.then(
          () => worker.postMessage({ kind: "close" }),
          () => worker.terminate()
        );
        workers.delete(engine);
      }
    });
  }
  const id = ++owner.sequence;
  owner.worker.onmessage = (event: MessageEvent<IllustrationReply>) => {
    const reply = event.data;
    if (reply.id !== id || engine.drawn.get("input") !== input) return;
    if (reply.error) {
      engine.drawn.set("illustrationError", reply.error);
      return;
    }
    applyDrawingProducts(engine, input, reply);
    engine.drawn
      .getSource()!
      .addFeatures([
        ...illustratedTerrain(input, reply.terrain),
        ...illustratedFields(input, reply.fields),
      ]);
  };
  const current = owner;
  void current.ready.then(
    () => {
      if (current.sequence === id && workers.get(engine) === current)
        current.worker.postMessage({ id, input, footprint });
    },
    (error: Error) => engine.drawn.set("illustrationError", error.message)
  );
}
