import { expect, it, vi } from "vitest";
import type { GenerationState } from "../process";
import { poiCatalogue } from "./catalogue";
import type { PoiPlace } from "./poiContract";
import { realized } from "./poiRealized";

vi.mock("../worldSignificance", async (original) => ({
  ...(await original<typeof import("../worldSignificance")>()),
  isWorldGeography: (state: { world: boolean }) => state.world,
}));

const map = (world: boolean) =>
    ({ world, physical: { magic: { fields: [] } } }) as unknown as GenerationState,
  place = (state?: string) =>
    ({ id: "x", cells: [0], anchor: 0, feature: state && { state } }) as unknown as PoiPlace;

it("leaves a work latent on the World unless someone authored it", () => {
  expect(realized(map(true), poiCatalogue.shrine, place())).toBe(false);
  expect(realized(map(true), poiCatalogue.shrine, place("authored"))).toBe(true);
  expect(realized(map(false), poiCatalogue.shrine, place())).toBe(true);
});

it("always realizes what the simulation decided", () => {
  expect(realized(map(true), poiCatalogue.settlement, place())).toBe(true);
  expect(realized(map(true), poiCatalogue.door, place())).toBe(true);
});
