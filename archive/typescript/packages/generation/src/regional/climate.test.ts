import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import { altitudeTemperature, fogPrecipitation } from "../world/climate";
import { atmosphericLengths, precipitationFromCapture, temperatureFromCapture } from "./climate";

it("replaces the inherited heat contribution rather than adding it twice", () => {
  expect(temperatureFromCapture(15, 5, 5, 0)).toBe(15);
  expect(temperatureFromCapture(15, 5, 0, 0)).toBe(10);
  expect(temperatureFromCapture(-10, -8, 0, 0)).toBe(-2);
});

it("lets current heat and local relief change the captured atmosphere independently", () => {
  expect(temperatureFromCapture(15, 5, 9, -6)).toBe(13);
  expect(temperatureFromCapture(15, 5, 9, 6)).toBe(25);
});

it("replaces fog drip separately from terrain-driven precipitation", () => {
  expect(precipitationFromCapture(100, 20, 20, 1)).toBe(100);
  expect(precipitationFromCapture(100, 20, 0, 1)).toBe(80);
  expect(precipitationFromCapture(100, 20, 40, 0.5)).toBe(80);
  expect(precipitationFromCapture(0, 0, 40, 1)).toBe(40);
});

it("keeps inherited atmospheric response lengths when the child frame and resolution shrink", () => {
  const frame = {
      WorldExtentX: [0, 4_000_000] as [number, number],
      WorldExtentY: [0, 3_000_000] as [number, number],
    },
    wide = new MapScale(1_000_000, 750_000, 10_000),
    narrow = new MapScale(250_000, 187_500, 1_000),
    first = atmosphericLengths(frame, wide.cellSpan),
    second = atmosphericLengths(frame, narrow.cellSpan);
  expect(first).toEqual(second);
  expect(altitudeTemperature(1000, 65, first.elevation)).toBe(65);
  expect(altitudeTemperature(1000, 65, second.elevation)).toBe(65);
  expect(altitudeTemperature(1000, 32.5, second.elevation)).toBe(32.5);
  expect(altitudeTemperature(-1000, 65, second.elevation)).toBe(-65);
  const capturedFog = fogPrecipitation(0.6, first.fogDrip),
    currentFog = fogPrecipitation(0.6, second.fogDrip);
  expect(precipitationFromCapture(100 + capturedFog, capturedFog, currentFog, 1)).toBeCloseTo(
    100 + capturedFog
  );
  expect(precipitationFromCapture(100 + capturedFog, capturedFog, 0, 1)).toBeCloseTo(100);
});
