import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { configureSpatial } from "@atlas/domain";
import { GeometryKernel, GeosSpatial, SpatialCatalog, ZarrResources } from "@atlas/storage-browser";
import { fileStoreFixture } from "../../../packages/storage-browser/src/fileStoreFixture";
import { blockCacheFixture } from "../../../packages/storage-browser/src/blockCacheFixture";
import {
  exportSqliteFixture,
  sqliteFixture,
  sqliteFixtureFrom,
} from "../../../packages/storage-browser/src/sqliteFixture";

/** Harness output: checkpoints and reports, under the repository's ignored output directory. */
export const harnessRoot = resolve(__dirname, "../../../.artifacts/harness");
/** Bytes of decoded field blocks the harness keeps resident. */
const workingBytes = 512 * 1024 * 1024;

/** What a checkpoint holds and how it was made: a report states its source, never assumes it. */
export interface CheckpointRecord {
  kind: "world" | "region";
  name: string;
  worldId: string;
  root: string;
  /** The refined region's map area, for a region checkpoint. */
  child?: string;
  /** The world checkpoint a region was refined from. */
  world?: string;
  seed: number;
  quality: string;
  width: number;
  height: number;
  /** Where a region was chosen, in map metres. */
  position?: [number, number];
  commit: string;
  createdAt: string;
}

export type HarnessWorkspace = Awaited<ReturnType<typeof openHarnessWorkspace>>;

/**
 * A workspace whose catalog and resources live in a checkpoint directory: the production
 * SQLite catalog, GEOS kernel and Zarr resources, with the catalog restored from and saved to
 * its exported bytes and the resources written as files.
 */
export async function openHarnessWorkspace(directory: string) {
  mkdirSync(join(directory, "resources"), { recursive: true });
  const saved = join(directory, "catalog.sqlite"),
    db = existsSync(saved)
      ? await sqliteFixtureFrom(new Uint8Array(readFileSync(saved)))
      : await sqliteFixture();
  const kernel = await GeometryKernel.create();
  configureSpatial((precision) => new GeosSpatial(kernel, precision));
  const catalog = new SpatialCatalog(db, kernel),
    files = fileStoreFixture(join(directory, "resources")),
    working = blockCacheFixture(workingBytes);
  return {
    directory,
    db,
    kernel,
    catalog,
    resources: new ZarrResources(files.store),
    working,
    /** Writes the catalog and the checkpoint's record; resources are already on disk. */
    async save(record: CheckpointRecord) {
      writeFileSync(saved, await exportSqliteFixture(db));
      writeFileSync(join(directory, "checkpoint.json"), JSON.stringify(record, null, 2));
    },
    /** The catalog closes its database and kernel. */
    async close() {
      configureSpatial();
      await catalog.close();
      working.close();
      files.close();
    },
  };
}
export const checkpointDirectory = (name: string) => join(harnessRoot, "checkpoints", name);
export function readCheckpoint(name: string): CheckpointRecord | undefined {
  const path = join(checkpointDirectory(name), "checkpoint.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}
/** A region starts from a copy of its world's checkpoint, so the world stays reusable. */
export function copyCheckpoint(from: string, to: string) {
  rmSync(checkpointDirectory(to), { recursive: true, force: true });
  cpSync(checkpointDirectory(from), checkpointDirectory(to), { recursive: true });
}
export function removeCheckpoint(name: string) {
  rmSync(checkpointDirectory(name), { recursive: true, force: true });
}
export function currentCommit() {
  try {
    const head = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(),
      dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
    return dirty ? `${head}+changes` : head;
  } catch {
    return "unknown";
  }
}
