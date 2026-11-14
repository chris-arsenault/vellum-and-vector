import { expect, it } from "vitest";
import type { GenerationState } from "../process";
import type { PoiOrigin } from "./poiContract";
import { resolveClaims } from "./poiOrigins";

const state = {} as GenerationState;
const origin = (id: string, cells: number[], reads: PoiOrigin["reads"] = []): PoiOrigin => ({
  id,
  statement: id,
  reads,
  finds: () => cells.map((anchor) => ({ anchor })),
});

it("gives a cell to the first origin that claims it", () => {
  const claims = resolveClaims(state, [origin("first", [1, 2]), origin("second", [2, 3])]);
  expect([...claims.values()].map((claim) => [claim.anchor, claim.origin])).toEqual([
    [1, "first"],
    [2, "first"],
    [3, "second"],
  ]);
});

it("shows an origin what the ones before it claimed", () => {
  const second: PoiOrigin = {
    id: "second",
    statement: "second",
    reads: [],
    finds: (_state, claimed) => (claimed.has(1) ? [] : [{ anchor: 9 }]),
  };
  expect([...resolveClaims(state, [origin("first", [1]), second]).keys()]).toEqual([1]);
});

it("holds an origin back until the kinds it reads exist", () => {
  const claims = resolveClaims(state, [origin("town", [5], ["settlement"])]);
  expect(claims.size).toBe(0);
  const refined = { regional: {} } as unknown as GenerationState;
  expect(resolveClaims(refined, [origin("town", [5], ["settlement"])]).size).toBe(1);
});
