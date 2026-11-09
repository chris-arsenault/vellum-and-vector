import { expect, it } from "vitest";
import { nextFaultId } from "./fractures";
import { landscape } from "../mapFixtures";
import { generatedFeature, putGenerated } from "../mapFeatures";

it("assigns separate identities to successive fault occurrences", () => {
  const faults: { id: string }[] = [],
    formation = { id: nextFaultId(faults) };
  faults.push(formation);
  const epoch = { id: nextFaultId(faults) };
  faults.push(epoch);
  expect(formation.id).not.toBe(epoch.id);
  expect(nextFaultId(faults)).not.toBe(epoch.id);
});

it("skips occupied identities in sparse inherited history without renaming it", () => {
  const inherited = [Object.freeze({ id: "fault:2" }), Object.freeze({ id: "fault:3" })],
    faults: Readonly<{ id: string }>[] = [...inherited],
    fresh = { id: nextFaultId(faults) };
  expect(fresh.id).toBe("fault:4");
  faults.push(fresh);
  expect(nextFaultId(faults)).toBe("fault:5");
  expect(faults.slice(0, 2)).toEqual(inherited);
});

it("publishes both older and later fault traces under their own causes", () => {
  const state = landscape(),
    faults: { id: string }[] = [];
  state.domain.world.id = "2f6e0134-6017-4e80-9196-052a12218500";
  const published = [100, 200].map((x) => {
    const fault = { id: nextFaultId(faults) };
    faults.push(fault);
    const feature = generatedFeature(
      state,
      fault.id,
      "Fault",
      "fault",
      "faults",
      {
        type: "LineString",
        coordinates: [
          [x, 100],
          [x, 200],
        ],
      },
      { causeId: fault.id }
    );
    expect(putGenerated(state, feature)).toBe(true);
    return feature;
  });
  expect(published[0].id).not.toBe(published[1].id);
  for (const feature of published) {
    const retained = state.domain.world.features[feature.id];
    expect(retained.geometry).toEqual(feature.geometry);
    expect(retained.attributes.causeId).toBe(feature.attributes.causeId);
  }
});
