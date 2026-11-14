import type { AtlasFeature } from "@atlas/domain";
import { describe, expect, it } from "vitest";
import { capturedDoor } from "./writes";

const record = (kind: string, layerId: string, attributes: Record<string, unknown>): AtlasFeature =>
  ({ kind, layerId, attributes }) as unknown as AtlasFeature;
const veilDoor = (ends: number[][], extra: Record<string, unknown> = {}) =>
  record("veil:door", "magic", { system: "veil", rule: "door", ends, ...extra });
/** A frame of cells numbered by x; anything at or past 100 lies outside it. */
const cellOf = (x: number) => (x < 100 ? x : -1);

describe("capturedDoor", () => {
  it("reads a two-ended record as both its ends", () => {
    expect(
      capturedDoor(
        veilDoor([
          [3, 0],
          [7, 0],
        ]),
        "veil",
        cellOf
      )
    ).toEqual({ a: 3, b: 7 });
  });

  it("treats an end outside the frame as one-ended, whichever end it is", () => {
    const near = [3, 0],
      far = [500, 0];
    expect(capturedDoor(veilDoor([near, far]), "veil", cellOf)).toEqual({ a: 3, b: 3 });
    expect(capturedDoor(veilDoor([far, near]), "veil", cellOf)).toEqual({ a: 3, b: 3 });
  });

  it("reads a record that stores one end as one-ended", () => {
    expect(capturedDoor(veilDoor([[3, 0]]), "veil", cellOf)).toEqual({ a: 3, b: 3 });
  });

  it("drops a door with neither end on the frame", () => {
    expect(
      capturedDoor(
        veilDoor([
          [500, 0],
          [600, 0],
        ]),
        "veil",
        cellOf
      )
    ).toBeNull();
  });

  it("reads a door by system and rule, so a building's door is not one", () => {
    const building = record("door", "structures", { ends: [[3, 0]] });
    expect(capturedDoor(building, "veil", cellOf)).toBeNull();
    expect(capturedDoor(veilDoor([[3, 0]]), "fire", cellOf)).toBeNull();
  });

  it("leaves this map's own products to be regenerated", () => {
    expect(
      capturedDoor(veilDoor([[3, 0]], { developedBy: "regional" }), "veil", cellOf)
    ).toBeNull();
  });

  it("reads the parent's ends from a record an earlier refinement moved", () => {
    const moved = veilDoor([[9, 0]], {
      capturedRecord: {
        attributes: {
          system: "veil",
          rule: "door",
          ends: [
            [3, 0],
            [7, 0],
          ],
        },
      },
    });
    expect(capturedDoor(moved, "veil", cellOf)).toEqual({ a: 3, b: 7 });
  });
});
