import { expect, it, vi } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { physicalContext } from "../world/context";
import { physicalProfile } from "../world/profile";
import { fieldQuery } from "../processes/builder";
import { actBy, actTogether } from "../processes/processRunner";
import { bindOperation, invalidateProcesses } from "../processOperation";
import { ask, explainAnswer } from "./answers";
import { waterOff } from "../processes/waterProcesses";

const field = () => createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
const context = (map: ReturnType<typeof field>) =>
  physicalContext(1, 0, map.scale.resolve(physicalProfile));

it("inspection does not refresh queries or change retained answers", () => {
  const map = field(),
    c = context(map),
    refresh = vi.fn(() => map.Runoff.fill(200));
  map.Runoff.fill(100);
  bindOperation(map, waterOff.operation, refresh);
  const observed = explainAnswer(map, "discharge", 0, c).value;
  expect(refresh).not.toHaveBeenCalled();
  expect(map.Runoff.get(0)).toBe(100);
  expect(ask(map, "discharge", c).get(0)).toBeCloseTo(observed * 2);
  expect(refresh).toHaveBeenCalledOnce();
});

it("field queries resolve dependencies with zero work and reread changed inputs", () => {
  const map = field(),
    c = context(map),
    events: string[] = [];
  let input = 2,
    output = 0;
  const source = fieldQuery(
    {
      id: "source",
      statement: "Supplied source.",
      execute: ({ context }) => {
        expect(context.Span).toBe(0);
        expect(context.LocalDevelopment).toBe(false);
        events.push("source");
        output = input;
      },
    },
    []
  );
  const consumer = fieldQuery(
    {
      id: "consumer",
      statement: "Supplied consumer.",
      execute: () => {
        events.push(`read:${output}`);
      },
    },
    [source]
  );
  bindOperation(map, source.operation);
  bindOperation(map, consumer.operation);
  actBy(consumer, consumer)(map, c);
  expect(events).toEqual(["source", "read:2"]);
  input = 7;
  invalidateProcesses(map);
  actBy(consumer)(map, c);
  expect(events.slice(-2)).toEqual(["source", "read:7"]);
  expect(() => actTogether(consumer)).toThrow("cannot run together");
});
