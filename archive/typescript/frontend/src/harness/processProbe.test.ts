import { expect, it, vi } from "vitest";
import { createField } from "../../../packages/generation/src/world/field";
import { createWorldMesh } from "../../../packages/generation/src/world/worldMesh";
import { physicalContext } from "../../../packages/generation/src/world/context";
import { physicalProfile } from "../../../packages/generation/src/world/profile";
import {
  applyNativeStep,
  observeNativeProcesses,
  runNativeStep,
} from "../../../packages/generation/src/world/physicalSteps";
import { defineProcess } from "../../../packages/generation/src/processes/groundProcess";
import { nativeOperation } from "../../../packages/generation/src/processes/processRunner";
import { capturedAnswersAt } from "../../../packages/generation/src/coupling/answers";
import { invalidateProcesses } from "../../../packages/generation/src/processOperation";
import { processProbe, processProbeBands, startProcessProbe } from "./processProbe";

it("records actual process boundaries at one coordinate through the native step adapter", () => {
  const map = createField(createWorldMesh([0, 0, 1_000, 1_000], 16, 0));
  map.Temperature.fill(500);
  const probe = processProbe([
    map.mesh.origin[0] + map.mesh.x(0),
    map.mesh.origin[1] + map.mesh.y(0),
  ]);
  const process = defineProcess({
    id: "inspection-probe",
    statement: "Tests observation delivery.",
    reads: [],
    writes: ["Quickening"],
    asks: ["warmth"],
    moves: [],
    settings: {},
    prepare: () => ({}),
    execute({ field }) {
      field.Quickening.fill(1);
    },
  });
  const context = physicalContext(1, 0, map.scale.resolve(physicalProfile)),
    existing = vi.fn();
  context.ObserveProcess = existing;
  observeNativeProcesses(probe.observe);
  try {
    applyNativeStep(map, context, [
      "probe-step",
      0,
      nativeOperation("probe-step", [process]),
      [process],
    ]);
  } finally {
    observeNativeProcesses(null);
  }
  expect(existing).toHaveBeenCalledTimes(3);
  expect(probe.read()).toMatchObject([
    {
      step: "probe-step",
      processes: ["inspection-probe"],
      phase: "before",
      capturedAnswers: { warmth: 1 },
      answers: { warmth: { value: 1 } },
    },
    { phase: "after-run", capturedAnswers: { warmth: 1 }, answers: { warmth: { value: 2 } } },
    { phase: "settled", answers: { warmth: { value: 2 } } },
  ]);
  // Stored samples contain values, so later field changes cannot rewrite the observation.
  map.Quickening.fill(0);
  expect(probe.read().at(-1)).toMatchObject({ answers: { warmth: { value: 2 } } });
});

it("locates world coordinates on translated maps and reads caller-selected fields", () => {
  const map = createField(createWorldMesh([100_000, 200_000, 101_000, 201_000], 16, 0)),
    at = [map.mesh.origin[0] + map.mesh.x(0), map.mesh.origin[1] + map.mesh.y(0)] as const,
    probe = processProbe(at, processProbeBands("Quickening,Runoff"));
  map.Quickening.set(0, 3);
  probe.observe(
    "sample",
    { processes: ["sample"], phase: "settled", substep: 0 },
    map,
    physicalContext(1, 0, map.scale.resolve(physicalProfile))
  );
  expect(probe.read()).toMatchObject([{ cell: 0, at, fields: { Quickening: 3, Runoff: 0 } }]);
  expect(() => processProbeBands("misspelled-band")).toThrow("Unknown process probe band");
  expect(capturedAnswersAt(map, 0)).toEqual({});
});

it("distinguishes a simultaneous group's captured inputs from current facts using its execution context", () => {
  const map = createField(createWorldMesh([0, 0, 1_000, 1_000], 16, 0)),
    probe = processProbe([map.mesh.origin[0] + map.mesh.x(0), map.mesh.origin[1] + map.mesh.y(0)]);
  map.Runoff.fill(100);
  const declaration = {
      statement: "Observation probe.",
      reads: [],
      asks: [],
      moves: [],
      settings: {},
      prepare: () => ({}),
    } as const,
    write = defineProcess({
      ...declaration,
      id: "write",
      writes: ["Runoff"],
      execute({ field }) {
        field.Runoff.set(0, 200);
      },
    }),
    consumed = vi.fn(),
    read = defineProcess({
      ...declaration,
      id: "read",
      asks: ["discharge"],
      execute({ ask }) {
        consumed(ask("discharge").get(0));
      },
    });
  observeNativeProcesses(probe.observe);
  try {
    const context = physicalContext(1, 0, map.scale.resolve(physicalProfile));
    context.Profile.FluvialReferenceRunoff = 100;
    runNativeStep(map, context, [
      "regional-probe",
      0,
      nativeOperation("regional-probe", [write, read], true),
      [write, read],
    ]);
  } finally {
    observeNativeProcesses(null);
  }
  expect(consumed).toHaveBeenCalledExactlyOnceWith(1);
  expect(probe.read()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        processes: ["read"],
        phase: "before",
        capturedAnswers: expect.objectContaining({ discharge: 1 }),
        answers: expect.objectContaining({ discharge: expect.objectContaining({ value: 2 }) }),
      }),
    ])
  );
  invalidateProcesses(map);
  expect(capturedAnswersAt(map, 0)).toEqual({});
});

it("publishes partial samples on failure and detaches before publication", () => {
  const map = createField(createWorldMesh([0, 0, 1_000, 1_000], 16, 0)),
    at = [map.mesh.origin[0] + map.mesh.x(0), map.mesh.origin[1] + map.mesh.y(0)] as const,
    publish = vi.fn(),
    stop = startProcessProbe(at, undefined, publish),
    broken = defineProcess({
      id: "broken",
      statement: "Failure probe.",
      reads: [],
      asks: [],
      moves: [],
      settings: {},
      prepare: () => ({}),
      execute() {
        throw new Error("probe failed");
      },
    }),
    run = () =>
      runNativeStep(map, physicalContext(1, 0, map.scale.resolve(physicalProfile)), [
        "probe",
        0,
        nativeOperation("probe", [broken]),
        [broken],
      ]);
  try {
    expect(run).toThrow("probe failed");
  } finally {
    stop();
  }
  expect(publish).toHaveBeenCalledOnce();
  expect(publish.mock.calls[0][0]).toMatchObject([{ processes: ["broken"], phase: "before" }]);
  expect(run).toThrow("probe failed");
  stop();
  expect(publish).toHaveBeenCalledOnce();
  expect(publish.mock.calls[0][0]).toHaveLength(1);
});
