import { expect, it } from "vitest";
import { pondLevel } from "../rock/groundDeposition";
import { lavaOffer, lavaYieldGradient, mobileLavaShare } from "./lavaRouting";

it("fills an occupied cut before overtopping intact ground", () => {
  expect(pondLevel(100, 0.75, 80, 0.25, 2)).toBe(88);
  expect(pondLevel(100, 0.75, 80, 0.25, 10)).toBe(105);
  expect(pondLevel(100, 1, 0, 0, 2)).toBe(102);
});
it("cannot feed lower ground across a barrier until local lava head overtops it", () => {
  const pond = pondLevel(5, 1, 0, 0, 3);
  expect(lavaOffer(pond, 10, 1, 1, 1, 0)).toBe(0);
  const filled = pondLevel(5, 1, 0, 0, 7);
  expect(lavaOffer(filled, 10, 1, 1, 1, 0)).toBeGreaterThan(0);
  expect(lavaOffer(filled, 4, 1, 1, 1, 0)).toBeGreaterThan(lavaOffer(filled, 10, 1, 1, 1, 0));
});
it("a newly raised neighboring deposit redirects the next local offer", () => {
  expect(lavaOffer(10, 5, 1, 1, 1, 0.1)).toBeGreaterThan(0);
  expect(lavaOffer(10, 12, 1, 1, 1, 0.1)).toBe(0);
  expect(lavaOffer(10, 7, 1, 1, 1, 0.1)).toBeGreaterThan(0);
});
it("a crossing cools part of the pulse and cannot exceed its remaining runout", () => {
  expect(mobileLavaShare(10, 0)).toBe(0);
  expect(mobileLavaShare(10, 10)).toBe(0);
  expect(mobileLavaShare(10, 20)).toBe(0.5);
});
it("thicker mobile lava can overcome resistance on a slope that arrests a thinner pulse", () => {
  expect(lavaOffer(10, 8, 100, 1, 1, lavaYieldGradient(0.02, 0.5))).toBe(0);
  expect(lavaOffer(10, 8, 100, 1, 1, lavaYieldGradient(0.02, 2))).toBeGreaterThan(0);
});
