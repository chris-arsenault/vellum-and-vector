import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Reopens the settings that started this job, when it stopped before finishing. */
  adjust?(): void;
  /** Called once when the job is cancelled or fails. */
  stopped?(): void;
}
/** Completion and stopping each notify once, however many times the status repeats. */
function useStatusChanges({ complete, stopped }: Props) {
  const handlers = useRef({ complete, stopped });
  const ended = useRef<GenerationStatus["state"] | null>(null);
  useEffect(() => {
    handlers.current = { complete, stopped };
  }, [complete, stopped]);
  return useCallback((status: GenerationStatus) => {
    if (status.state === "running") ended.current = null;
    if (status.state === "running" || ended.current === status.state) return;
    ended.current = status.state;
    if (status.state === "completed") {
      if (status.result) handlers.current.complete(status.result);
    } else handlers.current.stopped?.();
  }, []);
}
function useJobObservation(props: Props) {
  const { context, initial, published } = props;
  const [status, setStatus] = useState(initial);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const changed = useRef(published);
  const ended = useStatusChanges(props);
  useEffect(() => {
    changed.current = published;
  }, [published]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      for await (const event of context.generation.observe(initial.jobId, {
        signal: controller.signal,
      })) {
        if (event.kind === "preview")
          setPreviews((previous) => [...previous, event.preview as Preview]);
        else if (event.kind === "published") changed.current(event.reference);
        else {
          setStatus(event.status);
          ended(event.status);
        }
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) setError(error);
    });
    return () => controller.abort();
  }, [context, initial.jobId, attempt, ended]);
  const resume = async () => {
    try {
      setError(null);
      setStatus(await context.generation.resume(initial.jobId));
      setAttempt((value) => value + 1);
    } catch (error) {
      setError(error);
    }
  };
  return { status, previews, error, setError, resume };
}
// Arconis: docs/architecture/subsystems.arconis#item=j_progress — progress panel with previews and cancel.
export function FinishedGeneration(props: Props) {
  const { context, complete, close } = props;
  const { status, previews, error, setError, resume } = useJobObservation(props);
  return (
    <section className="finished-generation" aria-label="Generation job">
      <GenerationTiming status={status} />
      <h2>{status.step}</h2>
      <p>{status.state}</p>
      <progress aria-label="Generation progress" value={status.progress ?? undefined} max={1} />
      {status.message && <p>{status.message}</p>}
      <JobRecovery status={status} resume={resume} />
      {status.state === "running" && (
        <button onClick={() => void context.generation.cancel(status.jobId).catch(setError)}>
          Cancel generation
        </button>
      )}
      <JobOutcome status={status} complete={complete} adjust={props.adjust} />
      <button onClick={close}>
        {status.state === "running" ? "Close progress" : "Close generation"}
      </button>
      {status.state === "running" && context.mode === "backend" && (
        <p>Generation continues on the server. Find it in Server maps.</p>
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
function JobOutcome({
  status,
  complete,
  adjust,
}: {
  status: GenerationStatus;
  complete(reference: MapRef): void;
  adjust?(): void;
}) {
  if (status.state === "completed")
    return status.result && <button onClick={() => complete(status.result!)}>Open map</button>;
  if (status.state === "running" || !adjust) return null;
  return <button onClick={adjust}>Change settings</button>;
}
function JobRecovery({ status, resume }: { status: GenerationStatus; resume(): Promise<void> }) {
  if (["running", "completed"].includes(status.state)) return null;
  return (
    <div>
      <p>
        {status.recovery?.checkpoint
          ? `Resume from: ${status.recovery.checkpoint}`
          : "No completed checkpoint is available. This job can restart from the beginning."}
      </p>
      {status.recovery?.problem && <p>{status.recovery.problem}</p>}
      <button disabled={!!status.recovery?.problem} onClick={() => void resume()}>
        {status.recovery?.checkpoint ? "Resume generation" : "Restart from beginning"}
      </button>
    </div>
  );
}
function GenerationTiming({ status }: { status: GenerationStatus }) {
  const details = status.details;
  if (!details) return null;
  return (
    <>
      <h2>{details.name}</h2>
      <p>Elapsed: {Math.round(details.elapsedSeconds)} seconds</p>
      {details.epochs.length > 0 && (
        <details>
          <summary>Epoch durations</summary>
          <ul>
            {details.epochs.map((epoch, index) => (
              <li key={index}>
                {epoch.name}: {Math.round(epoch.seconds)} seconds
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
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
