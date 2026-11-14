import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { beforeAll, afterAll, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { Encoder } from "cbor-x";
import { initializeEngine } from "@atlas/engine";
import {
  configureSpatial,
  createWorldBlueprint,
  rectangle,
  type CatalogRecord,
  type WorldMetadata,
} from "@atlas/domain";
import { GeosSpatial } from "@atlas/storage-browser";
import { fileURLToPath } from "node:url";
import {
  initializeMapSchema,
  PostgresMapPublication,
  grantMapReader,
  initializeGenerationSchema,
  PostgresGenerationInputs,
} from "@atlas/storage-postgres";
import { httpMapReader, httpMapNavigation, httpMapLibrary } from "@atlas/transport";
import { registryFixture, registryRequest } from "../../storage-browser/src/mapRegistryFixture";
import { sample } from "../../storage-browser/src/mapPublicationFixture";
import { mapAssetPath } from "./mapFiles";
import { NativeWorkspaces } from "./nativeWorkspace";
import { NativeMapAssets } from "./nativeMapAssets";

let container: StartedPostgreSqlContainer, owner: Pool, reader: Pool;
let server: ReturnType<typeof spawn>, serverClosed: Promise<void>;
let directory = "",
  baseUrl = "";
const { map, features } = registryFixture();
const bytes = Uint8Array.from({ length: 32 }, (_, i) => i);
beforeAll(async () => {
  await initializeEngine(
    await readFile(new URL("../../engine/dist/atlas_host_bg.wasm", import.meta.url))
  );
  directory = await mkdtemp(join(tmpdir(), "atlas-map-http-"));
  container = await new PostgreSqlContainer("postgis/postgis:16-3.5").start();
  owner = new Pool({ connectionString: container.getConnectionUri() });
  await initializeMapSchema(owner);
  await initializeGenerationSchema(owner);
  const publication = new PostgresMapPublication(owner);
  await publication.begin(map, null, true);
  const assets = ["places", "height"].map((id) => ({
    id,
    location: `${id}.tif`,
    mediaType: "image/tiff",
    byteLength: bytes.length,
    illustration: false,
  }));
  for (const asset of assets) await writeFile(join(directory, asset.location), bytes);
  await publication.append(map.reference, { features, samples: [sample], assets });
  await publication.finish(map.reference);
  await owner.query("CREATE ROLE atlas_http_reader");
  await grantMapReader(owner, "atlas_http_reader");
  reader = new Pool({
    connectionString: container.getConnectionUri(),
    options: "-c role=atlas_http_reader",
  });
  baseUrl = await startRustServer();
});
afterAll(async () => {
  server?.kill();
  await serverClosed;
  await reader?.end();
  await owner?.end();
  await container?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function startRustServer() {
  const readerUrl = new URL(container.getConnectionUri());
  readerUrl.searchParams.set("options", "-c role=atlas_http_reader");
  readerUrl.search = readerUrl.search.replaceAll("+", "%20");
  server = spawn(
    fileURLToPath(new URL("../../../target/debug/atlas_server", import.meta.url)),
    [],
    {
      stdio: ["ignore", "pipe", "inherit"],
      env: {
        ...process.env,
        ATLAS_BIND: "127.0.0.1:0",
        ATLAS_MAP_DATABASE_URL: container.getConnectionUri(),
        ATLAS_MAP_READER_URL: readerUrl.href,
        ATLAS_MAP_ASSETS: directory,
      },
    }
  );
  serverClosed = new Promise((resolve) => server.once("close", () => resolve()));
  const lines = createInterface({ input: server.stdout! });
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`Map server closed (${code})`)));
    lines.once("line", (line) => {
      lines.close();
      resolve(line);
    });
  });
}

it("keeps views through native computation and rejects concurrent navigation writes", async () => {
  const navigation = httpMapNavigation(baseUrl);
  const state = await navigation.read(map.reference);
  const first = await navigation.commit(map.reference, state.version, {
    kind: "putView",
    data: { id: "physical", name: "Physical map", regionId: null, settings: { base: "relief" } },
  });
  expect(first.views[0].settings.base).toBe("relief");
  expect((await navigation.read(map.reference)).version).toBe(first.version);
  const change = { kind: "putView" as const, data: { ...first.views[0], name: "Updated" } };
  const writes = await Promise.allSettled([
    navigation.commit(map.reference, first.version, change),
    navigation.commit(map.reference, first.version, change),
  ]);
  expect(writes.filter((write) => write.status === "fulfilled")).toHaveLength(1);
  expect(writes.filter((write) => write.status === "rejected")).toHaveLength(1);
  await expect(navigation.commit(map.reference, state.version, change)).rejects.toThrow("changed");
});

it("serves the real map facade using the restricted map role and binary responses", async () => {
  const maps = httpMapReader(baseUrl);
  expect((await maps.open(map.reference)).state).toBe("complete");
  expect(
    (await maps.registry(map.reference, registryRequest())).rows.map((r) => r.feature.id)
  ).toEqual(["town", "neighbour"]);
  expect(
    (await maps.inspect(map.reference, { spaceId: "surface", position: [5, 5] })).samples[0].value
  ).toBe(25);
  expect((await maps.settlement(map.reference, "town"))?.related.map((f) => f.id)).toEqual([
    "neighbour",
    "realm",
    "way",
  ]);
  const selected = await maps.selectRegion(map.reference, {
    spaceId: "surface",
    featureIds: ["realm"],
  });
  expect(selected.parent).toEqual(map.reference);
  expect((await maps.asset(map.reference, "height")).bytes).toEqual(bytes);
  const exported = await maps.export(map.reference, "geojson");
  expect(JSON.parse(new TextDecoder().decode(exported.bytes)).features).toHaveLength(5);
});

it("reopens an explicit save on another client and rejects stale saves", async () => {
  const first = httpMapLibrary(baseUrl),
    second = httpMapLibrary(baseUrl);
  const navigation = await httpMapNavigation(baseUrl).read(map.reference);
  const request = {
    reference: map.reference,
    expectedVersion: null,
    navigationVersion: navigation.version,
    settings: { base: "relief" },
  };
  const saved = await first.save(request);
  expect(await second.open(map.reference.mapId)).toEqual(saved);
  expect((await second.list()).items[0].reference).toEqual(map.reference);
  const writes = await Promise.allSettled([
    first.save({ ...request, expectedVersion: saved.version, settings: { base: "geology" } }),
    second.save({ ...request, expectedVersion: saved.version }),
  ]);
  expect(writes.filter((write) => write.status === "fulfilled")).toHaveLength(1);
  expect(writes.filter((write) => write.status === "rejected")).toHaveLength(1);
});

it("retains private native inputs independently of later parent catalog changes", async () => {
  const inputs = new PostgresGenerationInputs(owner);
  const workspaces = new NativeWorkspaces(join(directory, "generation"), inputs);
  const workspace = await workspaces.open("parent");
  configureSpatial((precision) => new GeosSpatial(workspace.catalog.kernel, precision));
  try {
    const { blueprint, metadata } = privateWorld();
    await workspace.catalog.createWorld(metadata);
    const record: CatalogRecord = {
      scope: { worldId: blueprint.id, spaceId: blueprint.id, areaId: blueprint.root.id },
      reference: { kind: "area", id: blueprint.root.id, revision: 0 },
      data: { kind: "area", value: blueprint.root },
    };
    const changes = {
      operationId: crypto.randomUUID(),
      worldId: blueprint.id,
      expected: [record.reference],
      writes: [record],
      removes: [],
      resources: [],
    };
    await workspace.catalog.commit(changes);
    const reference = { mapId: blueprint.root.id, revision: "captured" };
    const retained = await workspace.retainInputs({
      reference,
      worldId: blueprint.id,
      areaId: blueprint.root.id,
      revision: 1,
    });
    record.reference.revision = 1;
    record.data = { kind: "area", value: { ...blueprint.root, name: "Revised parent" } };
    await workspace.catalog.commit({ ...changes, operationId: crypto.randomUUID() });
    expect(await inputs.read(reference)).toEqual(retained);
    await workspaces.read(reference, async (catalog) => {
      expect((await catalog.readEditor(blueprint.id)).areas[blueprint.root.id].name).toBe(
        blueprint.root.name
      );
      await expect(catalog.createWorld({ ...metadata, id: crypto.randomUUID() })).rejects.toThrow(
        "readonly"
      );
    });
    const child = await workspaces.open("child", reference);
    try {
      expect((await child.catalog.readEditor(blueprint.id)).areas[blueprint.root.id].name).toBe(
        blueprint.root.name
      );
    } finally {
      await child.close();
    }
    expect((await workspace.catalog.readEditor(blueprint.id)).areas[blueprint.root.id].name).toBe(
      "Revised parent"
    );
    await expect(
      workspace.retainInputs({ ...retained, reference: { ...reference, revision: "stale" } })
    ).rejects.toThrow("geography changed");
    await expect(new PostgresGenerationInputs(reader).read(reference)).rejects.toThrow(
      "permission denied"
    );
  } finally {
    configureSpatial();
    await workspace.close();
  }
});

function privateWorld() {
  const blueprint = createWorldBlueprint({
    id: crypto.randomUUID(),
    name: "Captured world",
    seed: 42,
    reference: {
      id: "metres",
      topology: "planar",
      units: "metre",
      axes: "east,north,up",
      verticalDatum: "Sea level",
      domain: rectangle([0, 0, 100, 100]),
      precision: 1e-6,
      version: 1,
    },
  });
  const metadata: WorldMetadata = {
    id: blueprint.id,
    name: blueprint.name,
    seed: blueprint.seed,
    reference: blueprint.reference,
    version: 0,
    owner: "creator",
    layers: {},
    fields: [],
    magic: [],
    landmarks: [],
    views: [],
    generations: [],
    epochs: [],
  };
  return { blueprint, metadata };
}

it("serves immutable map source ranges, suffixes, HEAD and unsatisfiable ranges", async () => {
  const source = await httpMapReader(baseUrl).source(map.reference, "height");
  expect(source.url).toBe(new URL(mapAssetPath(map.reference, "height"), baseUrl).href);
  const slice = await fetch(source.url, { headers: { Range: "bytes=5-9" } });
  expect(slice.status).toBe(206);
  expect(slice.headers.get("content-range")).toBe("bytes 5-9/32");
  expect(new Uint8Array(await slice.arrayBuffer())).toEqual(bytes.slice(5, 10));
  const suffix = await fetch(source.url, { headers: { Range: "bytes=-4" } });
  expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(bytes.slice(-4));
  const head = await fetch(source.url, { method: "HEAD" });
  expect(head.headers.get("content-length")).toBe("32");
  expect(await head.text()).toBe("");
  expect(head.headers.get("cache-control")).toContain("immutable");
  const outside = await fetch(source.url, { headers: { Range: "bytes=32-40" } });
  expect(outside.status).toBe(416);
  expect(outside.headers.get("content-range")).toBe("bytes */32");
});

it("writes finished raster and vector assets through the native host", async () => {
  const assets = new NativeMapAssets(
    directory,
    fileURLToPath(new URL("../../../target/debug/atlas_raster", import.meta.url)),
    1024 * 1024
  );
  const band = {
    id: "height",
    name: "Height",
    unit: "metre",
    display: { unit: "m", factor: 1 },
    nodata: null,
    categories: [],
    range: null,
  };
  const input = {
    assetId: "native-height",
    grid: { width: 2, height: 2, bounds: [0, 0, 10, 10] as [number, number, number, number] },
    planes: [{ band, resampling: "mean" as const }],
  };
  async function* rows() {
    yield new Float32Array([10, 1, 20, 1, 30, 1, 40, 1]);
  }
  const raster = await assets.raster(input, rows());
  expect(raster.source).toMatchObject({
    width: 2,
    height: 2,
    mediaType: "image/tiff; application=geotiff",
  });
  expect(raster.asset.byteLength).toBeGreaterThan(0);
  expect((await assets.file(raster.asset.location)).size).toBe(raster.asset.byteLength);
  const vector = await assets.vectors(
    "native-places",
    (async function* () {
      yield* features;
    })()
  );
  const content = JSON.parse(await (await assets.file(vector.location)).text());
  expect(content.features.map((feature: { id: string }) => feature.id)).toEqual(
    features.map((feature) => feature.id)
  );
  const abort = new AbortController();
  abort.abort();
  await expect(assets.raster(input, rows(), abort.signal)).rejects.toThrow();
});

it("rejects non-map methods and stale references instead of opening another host", async () => {
  const response = await fetch(new URL("api/maps/read", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/cbor" },
    body: new Uint8Array(new Encoder().encode({ method: "constructor", args: [map.reference] })),
  });
  expect(response.status).toBe(400);
  await expect(
    httpMapReader(baseUrl).open({ ...map.reference, revision: "absent" })
  ).rejects.toThrow("not found");
});
