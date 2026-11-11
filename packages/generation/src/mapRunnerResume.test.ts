import { expect, it } from "vitest";
import { mapCommand } from "./processTraits";
import { configuration, epoch, invoke, landscape, options } from "./mapFixtures";
import { MapRunner } from "./mapRunner";
import { MapProcessRegistry, type MapProcess, type ProcessSequence } from "./process";

function process(
  id: string,
  kind: "initialize" | "event",
  apply: Parameters<typeof mapCommand>[2],
  requires: string[] = []
): MapProcess {
  return {
    contract: { id, version: "1", parameters: {}, requires, produces: [id], invalidates: [] },
    operation: mapCommand(id, kind, apply, []),
    validate: () => [],
  };
}
function history(log: string[]) {
  const build = process("build", "initialize", (_state, context) => {
      log.push(`build:${context.epochs.at(-1)?.id ?? "start"}`);
    }),
    work = process(
      "work",
      "event",
      (_state, context) => {
        log.push(`work:${context.epochs.at(-1)!.id}`);
      },
      ["build"]
    );
  const sequence: ProcessSequence = [
    invoke(build),
    {
      kind: "epochs",
      id: "history",
      resetFacts: [],
      epochs: [epoch("first", 1), epoch("second", 1), epoch("third", 1)],
      body: [invoke(work)],
    },
  ];
  return new MapRunner(
    configuration(sequence),
    new MapProcessRegistry().register(build).register(work)
  );
}

it("continues after a completed epoch: initializers run, earlier work does not, later work does", async () => {
  const log: string[] = [];
  const result = await history(log).run(landscape(), {
    ...options,
    resume: {
      after: ["second"],
      restore: (state) => {
        log.push("restore");
        state.history = [
          { path: ["history"], ancestry: [epoch("first", 1)], causes: [] },
          { path: ["history"], ancestry: [epoch("second", 1)], causes: [] },
        ];
      },
    },
  });
  expect(log).toEqual(["build:start", "restore", "work:third"]);
  expect(result.state.history.map((entry) => entry.ancestry.at(-1)?.id)).toEqual([
    "first",
    "second",
    "third",
  ]);
});
it("reports each completed epoch and the final state to the boundary observer", async () => {
  const seen: string[] = [];
  await history([]).run(landscape(), {
    ...options,
    boundary: (boundary) => {
      seen.push(boundary.kind === "final" ? "final" : boundary.ancestry.map((e) => e.id).join("/"));
    },
  });
  expect(seen).toEqual(["first", "second", "third", "final"]);
});
it("rejects a resume point the sequence does not contain", async () => {
  await expect(
    history([]).run(landscape(), { ...options, resume: { after: ["missing"], restore() {} } })
  ).rejects.toMatchObject({ code: "generation_resume" });
});
