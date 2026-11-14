import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import type { DomainSnapshot, EpochHistory, FeatureReader } from "@atlas/domain";
import { openHarnessMaps } from "../harness/harnessMaps";
import { mapSnapshotProduct } from "../mapSnapshotProduct";
import { publishMapProduct } from "../mapProductPublication";

/** Reuse the integration suite's completed world; no separate simulation runs here. */
export async function assertFinishedMap(
  snapshot: DomainSnapshot,
  features: FeatureReader,
  history: EpochHistory[]
) {
  const directory = mkdtempSync(join(tmpdir(), "atlas-finished-map-"));
  let maps = await openHarnessMaps(directory);
  const started = performance.now();
  try {
    const reference = { mapId: snapshot.scope.areaId, revision: "shared-world" };
    await publishMapProduct(
      maps,
      mapSnapshotProduct(snapshot, { reference, parent: null, expected: null }, features, history)
    );
    maps.save();
    maps.close();
    maps = await openHarnessMaps(directory);
    const map = maps.catalog.open(reference);
    expect(map.state).toBe("complete");
    for (const id of ["terrain", "raster:Temperature", "raster:TreeCover"])
      expect(map.layers.some((layer) => layer.id === id)).toBe(true);
    for (const system of snapshot.world.magicSystems!)
      expect(map.layers.some((layer) => layer.id === `raster:magic:${system.id}:intensity`)).toBe(
        true
      );
    const towns = maps.catalog.features(reference, {
      spaceId: map.primarySpaceId,
      layerIds: ["vector:settlements"],
    });
    expect(towns.items.length).toBeGreaterThan(0);
    const town = towns.items[0];
    expect(town.geometry.type).toBe("Point");
    if (town.geometry.type !== "Point") throw new Error("Expected a published settlement.");
    const samples = maps.catalog.samplesAt(
      reference,
      map.primarySpaceId,
      town.geometry.coordinates
    );
    expect(
      samples.flatMap((sample) => sample.attributes).some((value) => value.bandId === "value")
    ).toBe(true);
    expect(maps.catalog.history(reference).items.length).toBeGreaterThan(0);
    const drawings = maps.catalog.illustrationAssets(reference);
    expect(drawings).toHaveLength(1);
    const drawing = JSON.parse(await (await maps.assets.file(drawings[0].location)).text());
    expect(drawing.type).toBe("FeatureCollection");
    expect(
      drawing.features.some(
        (feature: { properties: { featureId: string | null } }) =>
          feature.properties.featureId === null
      )
    ).toBe(true);
    console.info("shared world finished map", {
      publicationMs: performance.now() - started,
      layers: map.layers.length,
      inspectionSamples: samples.length,
    });
  } finally {
    maps.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
