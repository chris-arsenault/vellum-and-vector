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
import { actBy, actTogether } from "../../../packages/generation/src/processes/processRunner";
import { capturedAnswersAt, worldMoved } from "../../../packages/generation/src/coupling/answers";
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
    run({ field }) {
      field.Quickening.fill(1);
    },
  });
  const context = physicalContext(1, 0, map.scale.resolve(physicalProfile)),
    existing = vi.fn();
  context.ObserveProcess = existing;
  observeNativeProcesses(probe.observe);
  try {
    applyNativeStep(map, context, ["probe-step", 0, actBy(process), [process]]);
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
    } as const,
    write = defineProcess({
      ...declaration,
      id: "write",
      writes: ["Runoff"],
      run({ field }) {
        field.Runoff.set(0, 200);
      },
    }),
    consumed = vi.fn(),
    read = defineProcess({
      ...declaration,
      id: "read",
      asks: ["discharge"],
      run({ ask }) {
        consumed(ask("discharge").get(0));
      },
    });
  observeNativeProcesses(probe.observe);
  try {
    runNativeStep(map, physicalContext(1, 0, map.scale.resolve(physicalProfile)), [
      "regional-probe",
      0,
      (field, context) =>
        actTogether(write, read)(field, {
          ...context,
          Profile: { ...context.Profile, FluvialReferenceRunoff: 100 },
        }),
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
  worldMoved(map);
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
      run() {
        throw new Error("probe failed");
      },
    }),
    run = () =>
      runNativeStep(map, physicalContext(1, 0, map.scale.resolve(physicalProfile)), [
        "probe",
        0,
        actBy(broken),
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
