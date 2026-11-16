import { unByKey } from "ol/Observable.js";
import { mapPosition, type Inspection, type MapReader, type Position } from "@atlas/map";
import type { PublishedMapEngine } from "./publishedMapEngine";
import type { PublishedFeature } from "./publishedAppearance";

export type PublishedTool =
  | "pan"
  | "inspect"
  | "inspect-cell"
  | "region-pick"
  | "region-outline"
  | "region-cut"
  | "region-edit"
  | "measure"
  | "edit";
export interface PublishedMapEvents {
  inspected(value: Inspection): void;
  position(value: Position): void;
  error(error: Error): void;
}
export function installPublishedInteractions(
  engine: PublishedMapEngine,
  reader: MapReader,
  tool: PublishedTool,
  callbacks: () => PublishedMapEvents
) {
  let request: AbortController | undefined;
  const run = (work: (signal: AbortSignal) => Promise<void>) => {
    request?.abort();
    const pending = new AbortController();
    request = pending;
    void work(pending.signal).catch((error: unknown) => {
      if (!pending.signal.aborted)
        callbacks().error(error instanceof Error ? error : new Error(String(error)));
    });
  };
  const click = engine.map.on("singleclick", (event) => {
    if (tool !== "inspect" && tool !== "inspect-cell") return;
    const featureIds = engine.map
      .getFeaturesAtPixel(event.pixel, { hitTolerance: 6 })
      .flatMap((feature) => {
        const record = feature.get("domain") as PublishedFeature | undefined;
        return record ? [record.id] : [];
      });
    run(async (signal) => {
      const value = await reader.inspect(
        engine.descriptor.reference,
        {
          spaceId: engine.space.id,
          position: event.coordinate as Position,
          tolerance: (engine.map.getView().getResolution() ?? 1) * 6,
          featureIds: tool === "inspect-cell" ? undefined : featureIds,
        },
        { signal }
      );
      signal.throwIfAborted();
      callbacks().inspected(value);
    });
  });
  const move = engine.map.on("pointermove", (event) =>
    callbacks().position(mapPosition(engine.space, event.coordinate as Position))
  );
  const target = engine.target;
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      request?.abort();
    }
  };
  target.addEventListener("keydown", key);
  return () => {
    request?.abort();
    unByKey([click, move]);
    target.removeEventListener("keydown", key);
  };
}
