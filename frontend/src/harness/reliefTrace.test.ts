import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NativeStepObserver } from "../../../packages/generation/src/world/physicalSteps";
import type { PhysicalField } from "../../../packages/generation/src/world/field";
import type { PhysicalContext } from "../../../packages/generation/src/world/context";
import { traceRelief } from "./reliefTrace";
import { MapScale } from "@atlas/domain";

const observed = vi.hoisted(() => ({
  observer: null as NativeStepObserver | null,
  now: 0,
  probe: vi.fn(() => {
    observed.now += 3;
  }),
  rock: vi.fn(() => {
    observed.now += 2;
  }),
  columns: vi.fn(() => {
    observed.now += 3;
    return { folds: 4 };
  }),
  failed: vi.fn<
    (input: unknown, map: PhysicalField, context: PhysicalContext, failure: unknown) => string
  >(() => "failure.bin"),
}));
vi.mock("../../../packages/generation/src/world/physicalSteps", () => ({
  observeNativeSteps: (observer: NativeStepObserver | null) => {
    observed.observer = observer;
  },
}));
vi.mock("./reliefProbes", () => ({
  reliefProbes: () => ({ observe: observed.probe, read: () => [] }),
}));
vi.mock("./rockTrace", () => ({
  rockTrace: () => ({
    observe: observed.rock,
    read: () => {
      observed.now += 7;
      return {};
    },
  }),
}));
vi.mock("./reliefColumn", () => ({ watchRockColumns: () => observed.columns }));
vi.mock("./epochStory", () => ({
  epochStory: () => {
    observed.now += 5;
    return {};
  },
}));
vi.mock("./fieldSnapshot", () => ({
  captureFailedField: observed.failed,
  snapshotRecorder: () => (name: string) => {
    if (name !== "physical-epoch-history") return false;
    observed.now += 11;
    return true;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  observed.now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => observed.now);
});
afterEach(() => vi.restoreAllMocks());

it("skips embedded scans, retains outer observations and separates snapshot cost", () => {
  const stop = traceRelief({ label: "supplied", quality: "Standard", seed: 42, epochs: [] }),
    map = { mesh: { count: 0 }, scale: MapScale.reference() } as PhysicalField,
    context = { EpochIndex: 0 } as PhysicalContext,
    embedded = {
      get mesh() {
        throw new Error("embedded field scan");
      },
    } as unknown as PhysicalField;
  observed.observer!("orogenic-construction", embedded, context, { depth: 1 });
  expect(observed.probe).not.toHaveBeenCalled();
  expect(observed.rock).not.toHaveBeenCalled();
  expect(observed.columns).not.toHaveBeenCalled();
  observed.observer!("plate-advection", map, context, { depth: 0 });
  observed.observer!("physical-epoch-history", map, context, { depth: 0 });
  const result = stop();
  expect(result.steps.map(({ name }) => name)).toEqual([
    "plate-advection",
    "physical-epoch-history",
  ]);
  expect(result.monitoring).toEqual({
    granularity: "outer-native-steps",
    observedSteps: 2,
    embeddedStepsSkipped: 1,
    snapshotsWritten: 1,
    observerMilliseconds: 10,
    snapshotMilliseconds: 11,
    finalizationMilliseconds: 15,
  });
  expect(result.columns).toEqual({ folds: 4 });
  expect(observed.observer).toBeNull();
  expect(observed.failed).not.toHaveBeenCalled();
  expect(result.failedSnapshot).toBeUndefined();
});

it("captures the last field after failed-step mutations with explicitly last-known context", () => {
  const input = { label: "failed", quality: "standard", seed: 57721, epochs: [] },
    stop = traceRelief(input),
    rainfall = { value: 1 },
    map = { mesh: { count: 0 }, scale: MapScale.reference(), rainfall } as unknown as PhysicalField,
    context = { EpochIndex: 2 } as PhysicalContext;
  observed.observer!("plate-advection", map, context, { depth: 0 });
  rainfall.value = -3;
  observed.failed.mockImplementationOnce(() => {
    observed.now += 13;
    return "failure.bin";
  });
  const result = stop("Rainfall is negative");
  expect(observed.failed).toHaveBeenCalledWith(input, map, context, {
    status: "failed",
    message: "Rainfall is negative",
    lastObservedStep: "plate-advection",
    lastObservedEpoch: 2,
  });
  expect(observed.failed.mock.calls[0][1]).toMatchObject({ rainfall: { value: -3 } });
  expect(result.failedSnapshot).toBe("failure.bin");
  expect(result.monitoring.snapshotMilliseconds).toBe(13);
  expect(observed.observer).toBeNull();
});
