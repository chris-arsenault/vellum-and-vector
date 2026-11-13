import { expect, it } from "vitest";
import { segmentLabels } from "./divides";

function suppliedGraphs() {
  return {
    terrain: {
      receiver: Int32Array.from([1, -1, -1, 2, 0, 1, 2, 8, 3]),
      order: Int32Array.from([1, 2, 0, 3, 4, 5, 6, 8, 7]),
      count: 9,
    },
    channels: Uint8Array.from([1, 1, 1, 1, 0, 0, 0, 0, 0]),
    retained: Int32Array.from([2, 2, 3, -1, -1, -1, -1, -1, -1]),
  };
}

it("labels owned river segments before following disagreeing terrain drainage", () => {
  const { terrain, channels, retained } = suppliedGraphs(),
    labels = segmentLabels(
      terrain,
      (cell) => channels[cell] > 0,
      (cell) => retained[cell]
    );
  // The retained confluence splits 0 and 1 from the downstream segment 2 -> 3.
  expect(Array.from(labels)).toEqual([0, 1, 3, 3, 0, 1, 3, 3, 3]);
});

it("keeps terrain catchments independent of the owned channel segmentation", () => {
  const { terrain, channels, retained } = suppliedGraphs();
  terrain.receiver[4] = 1;
  const labels = segmentLabels(
    terrain,
    (cell) => channels[cell] > 0,
    (cell) => retained[cell]
  );
  expect(Array.from(labels.subarray(0, 4))).toEqual([0, 1, 3, 3]);
  expect(labels[4]).toBe(1);
});

it("excludes cells rejected by the current river predicate from channel confluences", () => {
  const { terrain, channels, retained } = suppliedGraphs();
  // A dry or former-only course does not contribute a current channel at cell 1.
  channels[1] = 0;
  const labels = segmentLabels(
    terrain,
    (cell) => channels[cell] > 0,
    (cell) => retained[cell]
  );
  expect(labels[0]).toBe(3);
  expect(labels[2]).toBe(3);
  expect(labels[1]).toBe(1);
  expect(labels[5]).toBe(1);
});
