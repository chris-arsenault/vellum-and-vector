import { expect, it, vi } from "vitest";
import { physicalContext } from "../world/context";
import { createField } from "../world/field";
import { physicalProfile } from "../world/profile";
import { createWorldMesh } from "../world/worldMesh";
import { Stage } from "../coupling/stage";
import { defineProcess } from "./groundProcess";
import { actBy, actTogether } from "./processRunner";
import { builder } from "./builder";
import { coast, outsideWaves } from "./coast";

const field = () => createField(createWorldMesh([0, 0, 1_000, 1_000], 16, 0));
const context = (map: ReturnType<typeof field>) =>
  physicalContext(1, 0, map.scale.resolve(physicalProfile));
const declaration = {
  statement: "Executor probe.",
  reads: [],
  asks: [],
  moves: [],
  settings: {},
} as const;

it("binds a process's own helper once, with its inferred type, across substeps", () => {
  const read = vi.fn(),
    prepare = vi.fn(() => ({ report: (span: number) => read(span) }));
  const probe = defineProcess({
    ...declaration,
    id: "local-helper",
    prepare,
    substeps: () => 2,
    run({ tools, span }) {
      tools.report(span);
    },
  });
  const map = field(),
    c = context(map);
  actBy(probe)(map, c);
  expect(prepare).toHaveBeenCalledExactlyOnceWith(map);
  expect(read.mock.calls).toEqual([[c.Span / 2], [c.Span / 2]]);
});

it("refreshes shared facts between sequential processes and substeps", () => {
  const seen: number[] = [];
  const probe = defineProcess({
    ...declaration,
    id: "fact-change",
    writes: ["Runoff"],
    asks: ["discharge"],
    substeps: () => 2,
    run({ field, ask }) {
      seen.push(ask("discharge").get(0));
      field.Runoff.set(0, field.Runoff.get(0) * 2);
    },
  });
  const map = field();
  map.Runoff.fill(100);
  actBy(probe, probe)(map, context(map));
  expect(seen[0]).toBeGreaterThan(0);
  expect(seen.map((n) => n / seen[0])).toEqual([1, 2, 4, 8]);
});

it("freezes shared inputs for a simultaneous group and observes its joint settlement", () => {
  const seen: number[] = [],
    events: string[] = [];
  const write = defineProcess({
    ...declaration,
    id: "write",
    writes: ["Runoff"],
    run({ field }) {
      field.Runoff.set(0, 200);
    },
  });
  const read = defineProcess({
    ...declaration,
    id: "read",
    asks: ["discharge"],
    run({ ask }) {
      seen.push(ask("discharge").get(0));
    },
  });
  const map = field(),
    c = context(map);
  map.Runoff.fill(100);
  c.ObserveProcess = ({ processes, phase }) => events.push(`${processes.join("+")}:${phase}`);
  const settle = vi.spyOn(Stage.prototype, "settle").mockImplementation(() => {
    events.push("land");
    return new Map();
  });
  try {
    actTogether(write, read)(map, c);
  } finally {
    settle.mockRestore();
  }
  expect(events).toEqual([
    "write:before",
    "write:after-run",
    "read:before",
    "read:after-run",
    "land",
    "write+read:settled",
  ]);
  actBy(read)(map, context(map));
  expect(seen[1]).toBe(seen[0] * 2);
});

it("keeps immediate writers and whole-field builders out of joint stages", () => {
  const whole = builder({ id: "whole", statement: "Probe.", build: () => {} });
  for (const process of [coast, outsideWaves, whole])
    expect(() => actTogether(process)).toThrow(`${process.id} cannot run together`);
  const events: string[] = [],
    map = field(),
    c = context(map);
  c.ObserveProcess = ({ phase }) => events.push(phase);
  actBy(whole)(map, c);
  expect(events).toEqual(["before", "settled"]);
});
