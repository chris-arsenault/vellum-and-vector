import { expect, it, vi } from "vitest";
import { residentBand, spatial, type AtlasFeature, type DomainSnapshot } from "@atlas/domain";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { finalizeNamesProcess } from "../../../packages/generation/src/societyNaming";
import { nameGeographicFeature } from "../../../packages/generation/src/atlasNaming";
import { executeProcessBehavior } from "../../../packages/generation/src/processTraits";
import type { GenerationState } from "../../../packages/generation/src/process";
import { generationSource } from "../workspaceGeneration";
import {
  checkpointDirectory,
  harnessRoot,
  openHarnessWorkspace,
  readCheckpoint,
  type HarnessWorkspace,
} from "./harnessWorkspace";
import { openTerrain } from "./mapReport";
import { mapFeatures } from "./featureReport";

function observeBuffers() {
  const buffer = spatial.buffer.bind(spatial);
  return vi.spyOn(spatial, "buffer").mockImplementation((geometry, distance) => {
    try {
      return buffer(geometry, distance);
    } catch (error) {
      const path = join(harnessRoot, "naming-buffer.json");
      writeFileSync(path, JSON.stringify({ geometry, distance, precision: spatial.precision }));
      process.stdout.write(`Failing naming buffer saved to ${path}.\n`);
      throw error;
    }
  });
}

async function loadGeography(ws: HarnessWorkspace, domain: DomainSnapshot) {
  const eligible: AtlasFeature[] = [];
  for (const item of await mapFeatures(ws, domain.world.id, domain.scope.areaId)) {
    const feature = await ws.catalog.readFeature(domain.scope, item.id);
    // Society works name themselves at construction; finalization names geography.
    if (
      feature.state === "generated" &&
      !feature.protected &&
      feature.attributes.namingKind &&
      nameGeographicFeature(
        domain.world,
        feature.id,
        feature.kind,
        feature.geometry,
        feature.attributes
      )
    ) {
      delete feature.attributes.namedInEra;
      eligible.push(feature);
    }
    domain.world.features[feature.id] = feature;
  }
  return eligible;
}

/** Exercises naming on saved geography without regenerating or changing the checkpoint. */
it.skipIf(!process.env.HARNESS_NAMING)(
  "names the saved map using its completed society",
  async () => {
    const name = process.env.HARNESS_WORLD ?? "world",
      record = readCheckpoint(name);
    if (!record) throw new Error(`No saved world named ${name}.`);
    const ws = await openHarnessWorkspace(checkpointDirectory(name)),
      buffers = observeBuffers();
    try {
      const areaId = record.child ?? record.root,
        domain = await generationSource(ws.catalog, record.worldId, areaId),
        original = structuredClone(domain),
        terrain = await openTerrain(ws, record.worldId, areaId);
      try {
        const eligible = await loadGeography(ws, domain),
          region = domain.world.societies?.[areaId],
          band = () => residentBand("float64", new Float64Array(0)),
          state: GenerationState = {
            domain,
            surface: terrain.raster.field,
            facts: new Set(),
            history: [],
            society: region
              ? {
                  region,
                  owner: band(),
                  river: band(),
                  coast: band(),
                  mediumChanged: new Set(),
                  inherited: false,
                  changed: new Set(),
                }
              : undefined,
          };
        await executeProcessBehavior(finalizeNamesProcess(original), state, {
          scope: domain.scope,
          invocation: ["atlas.names"],
          parameters: {},
          epochs: [],
          epochIndices: [],
          causes: [],
          recordCause() {},
          progress() {},
          random: () => 0.5,
          cancelled: () => false,
        });
        expect(eligible.length).toBeGreaterThan(0);
        expect(
          eligible
            .filter((feature) => !feature.attributes.namedInEra)
            .map((feature) => feature.kind)
        ).toEqual([]);
        process.stdout.write(
          `Named ${eligible.length} features with ${region?.communities.length ?? 0} communities from ${name}.\n`
        );
      } finally {
        terrain.close();
      }
    } finally {
      buffers.mockRestore();
      await ws.close();
    }
  },
  1_800_000
);
