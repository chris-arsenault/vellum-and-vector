import { foldSamples, attachGrid, gridPosition, type GridArrays } from "@atlas/domain";
import { exerciseCatalogue, type KindExercise } from "@atlas/generation";
import type { RunObservers } from "./harnessGeneration";

/** The last process of every generation sequence. */
const lastStep = "atlas.names";

/** One completed or skipped step of a run, as the runner reported it. */
export interface StageEntry {
  path: string;
  process: string;
  outcome: "completed" | "skipped";
  milliseconds: number;
  /** Surface cells, and those inside the map. */
  surfaceCells?: number;
  activeCells?: number;
  /** Cells of the physical lattice the processes work on. */
  latticeCells?: number;
  /** Surface channels this step created or dropped. */
  added?: string[];
  removed?: string[];
}
export interface DiagnosticEntry {
  process: string;
  code: string;
  severity: string;
  outcome: string;
  message: string;
}

/**
 * Records a run step by step: what each process added to or dropped from the surface, the
 * cells it worked on, how long it took, which steps were skipped and every diagnostic. The
 * final preview grid locates the world's highest land for a default region.
 */
export function stageRecorder() {
  const stages: StageEntry[] = [],
    diagnostics: DiagnosticEntry[] = [],
    catalogue: Record<string, KindExercise> = {};
  let started = performance.now(),
    channels = new Set<string>(),
    preview: GridArrays | undefined;
  const observers: RunObservers = {
    progress(path, fraction, message) {
      // Nested sequences scale their fractions, so a step's start is known by its message.
      if (message.startsWith("Starting")) started = performance.now();
      if (message.startsWith("Skipped"))
        stages.push({
          path: path.join("/"),
          process: message.replace("Skipped ", ""),
          outcome: "skipped",
          milliseconds: 0,
        });
    },
    inspect(path, process, state) {
      const milliseconds = Math.round(performance.now() - started);
      // The run's last step: the map is complete, so the POI catalogue's rules can read it.
      if (process === lastStep) Object.assign(catalogue, exerciseCatalogue(state));
      const now = new Set(Object.keys(state.surface.channels));
      stages.push({
        path: path.join("/"),
        process,
        outcome: "completed",
        milliseconds,
        surfaceCells: state.surface.active.length,
        activeCells: foldSamples(state.surface.active, (sum, value) => sum + value, 0),
        latticeCells: state.physical?.map.mesh.count,
        added: [...now].filter((name) => !channels.has(name)),
        removed: [...channels].filter((name) => !now.has(name)),
      });
      channels = now;
    },
    diagnostic(item) {
      diagnostics.push({
        process: item.process,
        code: item.code,
        severity: item.severity,
        outcome: item.outcome,
        message: item.message,
      });
    },
    message(message) {
      if (message.kind === "preview") preview = message.grid;
    },
  };
  return { stages, diagnostics, catalogue, observers, highestLand: () => highestLand(preview) };
}

/** The highest active cell of the last preview, in map metres. */
function highestLand(preview?: GridArrays): [number, number] | undefined {
  if (!preview) return undefined;
  const grid = attachGrid(preview),
    height = grid.channels.elevation;
  if (!height) return undefined;
  let best = -1;
  for (let i = 0; i < grid.active.length; i++)
    if (grid.active.get(i) && (best < 0 || height.get(i) > height.get(best))) best = i;
  if (best < 0) return undefined;
  const { x, y } = gridPosition(grid, best);
  return [x, y];
}
