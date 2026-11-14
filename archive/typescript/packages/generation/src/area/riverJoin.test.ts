import { expect, it } from "vitest";
import { joinReaches, type ReachOnMap } from "./riverJoin";

const reach = (
  downstream: number | null,
  course: string | null,
  options: Partial<ReachOnMap> = {}
): ReachOnMap => ({
  downstream,
  course,
  inFrame: true,
  ...options,
});

it("joins the reaches of one course inside the frame into one river", () => {
  // A latent side channel (2) meets the course at every confluence and cuts it into reaches.
  const rivers = joinReaches([
    reach(1, "main"),
    reach(3, "main"),
    reach(1, null),
    reach(null, "main"),
  ]);
  expect(rivers).toEqual([{ riverId: "main", parts: [[0, 1, 3]] }]);
});

it("draws a course that leaves the frame and returns as one river of two parts", () => {
  const rivers = joinReaches([
    reach(null, "main"),
    reach(0, "main"),
    reach(1, "main", { inFrame: false }),
    reach(2, "main"),
    reach(3, "main"),
  ]);
  // The upstream part comes first, each part head to end.
  expect(rivers).toEqual([
    {
      riverId: "main",
      parts: [
        [4, 3],
        [1, 0],
      ],
    },
  ]);
});

it("keeps a tributary that is a river of its own separate", () => {
  const rivers = joinReaches([reach(2, "main"), reach(2, "branch"), reach(null, "main")]);
  expect(rivers).toEqual([
    { riverId: "main", parts: [[0, 2]] },
    { riverId: "branch", parts: [[1]] },
  ]);
});

it("keeps different owned memberships separate at their confluence", () => {
  const rivers = joinReaches([reach(1, "branch"), reach(null, "main")]);
  expect(rivers.map(({ riverId, parts }) => [riverId, parts])).toEqual([
    ["branch", [[0]]],
    ["main", [[1]]],
  ]);
});

it("assembles inherited memberships without assigning a parent's identity to another course", () => {
  const rivers = joinReaches([reach(1, "own"), reach(2, "parent"), reach(null, "parent")]);
  expect(rivers).toEqual([
    { riverId: "own", parts: [[0]] },
    { riverId: "parent", parts: [[1, 2]] },
  ]);
});

it("places every drawn reach in exactly one river and leaves out what is no river", () => {
  const reaches = [
      reach(2, "main"),
      reach(2, "branch"),
      reach(4, "main"),
      reach(4, null),
      reach(null, "main"),
      reach(4, "far", { inFrame: false }),
    ],
    rivers = joinReaches(reaches),
    drawn = rivers.flatMap(({ riverId, parts }) => parts.flat().map((index) => [index, riverId]));
  expect(new Map(drawn as [number, string][])).toEqual(
    new Map([
      [0, "main"],
      [2, "main"],
      [4, "main"],
      [1, "branch"],
    ])
  );
  expect(drawn).toHaveLength(4);
});
