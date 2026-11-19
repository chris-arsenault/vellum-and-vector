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
        crossings: [["Upper & lower", [[0,0],[1,1]]]],
        works: [["Charter & archive", [{type:"Polygon",coordinates:[[[0,0],[2,0],[2,2],[0,0]]]}]]],
        buildings: [[{type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,0]]]}, "residential", "2 Salt & Elm Road"]],
        passages: [],
        footpaths: [[[[0,2],[5,4]],0.7]],
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
    assert.match(early.svg, /stroke-width="0.7"/);
    assert.match(early.svg, /<title>Upper &amp; lower<\/title>/);
    assert.match(early.svg, /<title>Charter &amp; archive<\/title>/);
    assert.match(early.svg, /<title>2 Salt &amp; Elm Road<\/title>/);
    const frame = ({ svg }) => svg.match(/viewBox="([^"]+)"/)[1];
    assert.equal(frame(early), frame(mature));
    assert.doesNotMatch(early.svg, /L100\.00/);
    assert.match(mature.svg, /L100\.00/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
