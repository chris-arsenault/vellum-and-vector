import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GeometryKernel, retainCompletedInputs } from "@atlas/storage-browser";
import { publishedMapFixture } from "./testSupport/publishedMapFixture";
import { fixtureWorkspace, registerWorldSnapshot } from "./testSupport/workspaceFixture";
import { openHarnessMaps } from "./harness/harnessMaps";
import { GenerationMapClient } from "./workspaceMapProtocol";
import { operateWorkspaceMap } from "./workspaceMaps";
import type { WorkspaceClient } from "./WorkspaceClient";
import { generationSource } from "@atlas/application";
import { publishGeneratedMap } from "./generationMapPublication";
import type { MapRef } from "@atlas/map";

async function assertReopened(
  maps: Awaited<ReturnType<typeof openHarnessMaps>>,
  directory: string,
  reference: MapRef
) {
  maps.save();
  const reopened = await openHarnessMaps(directory);
  try {
    expect(reopened.catalog.open(reference)).toEqual(maps.catalog.open(reference));
    expect(reopened.catalog.illustrationAssets(reference)).toHaveLength(1);
  } finally {
    reopened.close();
  }
}

function publicationHost(
  current: Awaited<ReturnType<typeof fixtureWorkspace>>,
  maps: Awaited<ReturnType<typeof openHarnessMaps>>
) {
  const host = {
    catalog: current.catalog,
    retainInputs: (input: Parameters<typeof retainCompletedInputs>[2]) =>
      retainCompletedInputs(
        current.catalog.generationInputs,
        async () => {
          const path = `/completed_${crypto.randomUUID()}.sqlite3`;
          current.catalog.snapshot(path);
          return { name: "fixture", path };
        },
        input
      ),
  };
  const client = new GenerationMapClient((operation) => operateWorkspaceMap(host, maps, operation));
  const workspace = new Proxy(current.catalog, {
    get(target, key) {
      if (key === "maps") return client;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as WorkspaceClient;
  return { host, workspace };
}

it("publishes a supplied completed generation through the ordinary producer and retains its inputs", async () => {
  const { snapshot } = publishedMapFixture();
  registerWorldSnapshot(snapshot);
  const current = await fixtureWorkspace(snapshot.world.id);
  const directory = mkdtempSync(join(tmpdir(), "atlas-map-publication-"));
  const maps = await openHarnessMaps(directory);
  const { host, workspace } = publicationHost(current, maps);
  const kernel = await GeometryKernel.create();
  try {
    const source = await generationSource(
      current.catalog,
      snapshot.world.id,
      snapshot.scope.areaId
    );
    const reference = await publishGeneratedMap(
      { workspace, binary: current.files.store, kernel, mapAssets: maps.assets },
      source,
      { get: () => undefined, values: () => [] },
      source.world.version,
      new AbortController().signal
    );
    const product = maps.catalog.open(reference);
    expect(product.state).toBe("complete");
    expect(maps.catalog.head(reference.mapId)).toEqual(reference);
    expect(current.catalog.generationInputs.read(reference)).toMatchObject({
      worldId: snapshot.world.id,
      areaId: snapshot.scope.areaId,
      revision: source.world.version,
    });
    const terrain = product.layers.find((layer) => layer.id === "terrain")!;
    expect(terrain.source.kind).toBe("raster");
    if (terrain.source.kind !== "raster") throw new Error("Expected terrain raster.");
    const asset = maps.catalog.asset(reference, terrain.source.data.assetId);
    expect((await maps.assets.file(asset.location)).size).toBeGreaterThan(0);
    const samples = maps.catalog.samplesAt(reference, product.primarySpaceId, [50, 50]);
    expect(
      samples
        .flatMap((sample) => sample.attributes)
        .find((value) => value.layerId === "raster:Temperature")?.value
    ).toBe(0);
    expect(
      samples
        .flatMap((sample) => sample.sections)
        .find((section) => section.id.endsWith("ground-column"))?.records[0]
    ).toMatchObject({ "Layer, top first": "Basalt", Thickness: "12 m" });
    const failed = { ...reference, revision: "failed-replacement" };
    maps.publication.begin(
      { ...product, reference: failed, state: "incomplete" },
      reference,
      false
    );
    await expect(
      operateWorkspaceMap(host, maps, {
        kind: "completeMap",
        worldId: snapshot.world.id,
        reference: failed,
        revision: source.world.version,
      })
    ).rejects.toThrow("missing published asset");
    expect(() => current.catalog.generationInputs.read(failed)).toThrow("no completed inputs");
    expect(maps.catalog.head(reference.mapId)).toEqual(reference);
    maps.publication.discard(failed);
    await assertReopened(maps, directory, reference);
  } finally {
    kernel.close();
    maps.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
