import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { retainTownStage, retainedTownPictures } from "./town-preview.mjs";

test("a resumed collector renders retained and later streets in the same town frame", async () => {
  const directory = await mkdtemp(join(tmpdir(), "town-preview-"));
  const observation = (phase, round, length) => ({
    stage: { phase, round },
    fields: [],
    settlements: [
      {
        key: "town",
        name: "Town",
        centre: [0, 0],
        streets: [
          [
            [
              [0, 0],
              [length, 0],
            ],
            [5, 5],
            false,
          ],
        ],
        plots: [],
        buildings: [],
        passages: [],
      },
    ],
  });
  try {
    await retainTownStage(directory, observation("early", 1, 10));
    assert.equal((await retainedTownPictures(directory)).length, 2);
    await retainTownStage(directory, observation("mature", 18, 99));
    await retainTownStage(directory, observation("mature", 18, 100));
    const [early, mature, comparison] = await retainedTownPictures(directory);
    assert.match(comparison.svg, /Buildings only/);
    const frame = ({ svg }) => svg.match(/viewBox="([^"]+)"/)[1];
    assert.equal(frame(early), frame(mature));
    assert.doesNotMatch(early.svg, /L100\.00/);
    assert.match(mature.svg, /L100\.00/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
