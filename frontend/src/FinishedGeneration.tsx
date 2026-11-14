import { useEffect, useRef, useState } from "react";
import type { GenerationStatus } from "@atlas/context";
import type { MapRef } from "@atlas/map";
import type { FinishedContext } from "./App";
import { ErrorMessage } from "./ErrorMessage";

interface Preview {
  ancestry: { id: string }[] | null;
  grid: {
    width: number;
    height: number;
    active: number[];
    channels: Record<string, { values: number[] }>;
  };
}
interface Props {
  context: FinishedContext;
  initial: GenerationStatus;
  complete(reference: MapRef): void;
  published(reference: MapRef): void;
  close(): void;
}
export function FinishedGeneration({ context, initial, complete, published, close }: Props) {
  const [status, setStatus] = useState(initial);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [error, setError] = useState<unknown>(null);
  const completed = useRef(complete);
  const changed = useRef(published);
  useEffect(() => {
    completed.current = complete;
    changed.current = published;
  }, [complete, published]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      for await (const event of context.generation.observe(initial.jobId, {
        signal: controller.signal,
      })) {
        if (event.kind === "preview")
          setPreviews((previous) => [
            ...previous,
            JSON.parse(new TextDecoder().decode(event.map.bytes)) as Preview,
          ]);
        else if (event.kind === "published") changed.current(event.reference);
        else {
          setStatus(event.status);
          if (event.status.state === "completed" && event.status.result)
            completed.current(event.status.result);
        }
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) setError(error);
    });
    return () => controller.abort();
  }, [context, initial.jobId]);
  return (
    <section className="finished-generation" aria-label="Generation job">
      <h2>{status.step}</h2>
      <p>{status.state}</p>
      <progress aria-label="Generation progress" value={status.progress ?? undefined} max={1} />
      {status.message && <p>{status.message}</p>}
      {status.state === "running" ? (
        <button onClick={() => void context.generation.cancel(status.jobId).catch(setError)}>
          Cancel generation
        </button>
      ) : (
        <button onClick={close}>Close generation</button>
      )}
      {previews.length > 0 && (
        <details open>
          <summary>Epoch previews</summary>
          <div className="epoch-previews">
            {previews.map((preview, i) => (
              <GenerationPreview key={i} preview={preview} />
            ))}
          </div>
        </details>
      )}
      <ErrorMessage error={error} />
    </section>
  );
}
/** Render the detached display grid directly. It never becomes a numerical workspace. */
function GenerationPreview({ preview }: { preview: Preview }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current!.getContext("2d")!;
    const grid = preview.grid;
    const image = context.createImageData(grid.width, grid.height);
    const elevation = grid.channels.Elevation.values,
      sea = grid.channels.EffectiveSeaLevel.values;
    let high = 1;
    for (let i = 0; i < elevation.length; i++)
      if (grid.active[i]) high = Math.max(high, elevation[i] - sea[i]);
    for (let i = 0; i < elevation.length; i++) {
      if (!grid.active[i]) continue;
      const at =
        ((grid.height - 1 - Math.floor(i / grid.width)) * grid.width + (i % grid.width)) * 4;
      const height = Math.max(0, elevation[i] - sea[i]) / high;
      const water = elevation[i] < sea[i] || grid.channels.WaterKindCodes?.values[i] > 0;
      const ice = grid.channels.IceThickness?.values[i] > 0;
      const color = ice
        ? [230, 240, 245]
        : water
          ? [72, 117, 143]
          : [218 - 50 * height, 227 - 68 * height, 189 - 42 * height];
      image.data.set([...color, 255], at);
    }
    context.putImageData(image, 0, 0);
  }, [preview]);
  return (
    <figure>
      <canvas
        ref={canvas}
        width={preview.grid.width}
        height={preview.grid.height}
        aria-label="Epoch map preview"
      />
      <figcaption>
        {preview.ancestry?.map((epoch) => epoch.id).join(" / ") || "Present geography"}
      </figcaption>
    </figure>
  );
}
