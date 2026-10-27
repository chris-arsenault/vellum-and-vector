import { fixtureWorld, fixtureState, commitCommand } from "./testSupport/workspaceFixture";
import { expect, it } from "vitest";
import { atlasParametersSchema } from "@atlas/generation";
import { atlasPhysicalProfile } from "../../packages/generation/src/canonry/atlasProfile";
import {
  newGenerationDraft,
  prepareDraft,
  setFeatureSetting,
  draftWorldSnapshot,
} from "./generationDraft";
import { applyCartographicChoice, cartographicControls } from "./cartographicDraft";
import { canonicalGeometry, type Command } from "@atlas/domain";

it("defaults new worlds to Cylinder and preserves explicit legacy open configurations", async () => {
  const draft = newGenerationDraft();
  expect(prepareDraft(draft).source.world.reference.boundaryMode).toBe("cylinder");
  expect(draftWorldSnapshot(draft).world.reference.boundaryMode).toBe("cylinder");
  expect(atlasParametersSchema.parse({ wrapLongitude: 0 }).mapBoundary).toBe(0);
  expect(atlasPhysicalProfile({ mapBoundary: 2 }).WrapLongitude).toBe(0);
});

it.each([
  [0, "none"],
  [1, "cylinder"],
  [2, "ocean"],
] as const)("keeps boundary mode %s independent of latitude coverage", (value, mode) => {
  let draft = setFeatureSetting(newGenerationDraft(), "physical.foundation", "mapBoundary", value);
  draft = applyCartographicChoice(
    draft,
    cartographicControls().find((control) => control.id === "climate-coverage")!,
    "globe"
  );
  const prepared = prepareDraft(draft);
  expect(prepared.diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toEqual(
    value === 2 ? ["map_boundary_unavailable"] : []
  );
  expect(prepared.input.parameters!.mapBoundary).toBe(value);
  expect(prepared.source.world.reference.boundaryMode).toBe(mode);
});

it("authors one road across the seam with a shared canonical junction", async () => {
  const world = fixtureWorld({
    name: "Cylinder",
    seed: 73,
    width: 1000,
    height: 500,
    boundaryMode: "cylinder",
  });
  const areaId = Object.keys(world.areas)[0],
    id = crypto.randomUUID();
  const geometry = canonicalGeometry(world.reference, {
    type: "LineString",
    coordinates: [
      [950, 250, 0],
      [1050, 250, 0],
    ],
  });
  const command: Command = {
    operationId: crypto.randomUUID(),
    expectedVersion: world.version,
    kind: "putFeature",
    data: {
      areaId,
      feature: {
        id,
        name: "World road",
        kind: "road",
        layerId: "roads",
        geometry,
        attributes: {},
        relations: [],
        protected: true,
      },
    },
  };
  const result = (await commitCommand(world.id, command)).candidate;
  const reaches = Object.values(result.networkReaches!);
  expect(result.features[id].geometry.type).toBe("MultiLineString");
  expect(reaches).toHaveLength(2);
  const endpoints = reaches.flatMap((r) => [r.start, r.end]);
  expect(new Set(endpoints).size).toBe(3);
  const junction = endpoints.find((id) => endpoints.filter((other) => other === id).length === 2)!;
  expect(result.networkNodes![junction].position).toEqual({ x: 0, y: 250, z: 0 });
});

it("retains an existing blank world's open boundary when preparing its first generation", async () => {
  const world = fixtureWorld({
    name: "Open",
    seed: 73,
    width: 1000,
    height: 500,
    boundaryMode: "none",
  });
  const prepared = prepareDraft(newGenerationDraft(), fixtureState(world.id).snapshot);
  expect(prepared.source.world.reference.boundaryMode).toBe("none");
  expect(prepared.input.parameters?.mapBoundary).toBe(0);
});
