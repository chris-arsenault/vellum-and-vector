import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  openAsBlob,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { initializeEngine } from "@atlas/engine";
import { MapAssets, type MapAssetFiles } from "@atlas/storage-browser/maps";
import { GeometryKernel } from "@atlas/storage-browser";
import { MapCatalog } from "../../../packages/storage-browser/src/mapCatalog";
import { MapPublication } from "../../../packages/storage-browser/src/mapPublication";
import {
  exportSqliteFixture,
  sqliteFixture,
  sqliteFixtureFrom,
} from "../../../packages/storage-browser/src/sqliteFixture";

function files(directory: string): MapAssetFiles {
  mkdirSync(directory, { recursive: true });
  return {
    async file(location) {
      return new File([await openAsBlob(join(directory, location))], location);
    },
    async remove(location) {
      rmSync(join(directory, location), { force: true });
    },
    async create(location) {
      const file = openSync(join(directory, location), "wx+");
      let closed = false;
      return {
        read: (bytes, at) => readSync(file, bytes, 0, bytes.length, at),
        write: (bytes, at) => writeSync(file, bytes, 0, bytes.length, at),
        flush: () => fsyncSync(file),
        close() {
          if (!closed) {
            closeSync(file);
            closed = true;
          }
        },
      };
    },
  };
}

/** The ordinary publisher and WASM asset writer, with host files in place of OPFS. */
export async function openHarnessMaps(directory: string) {
  await initializeEngine(
    readFileSync(new URL("../../../packages/engine/dist/atlas_host_bg.wasm", import.meta.url))
  );
  const path = join(directory, "maps.sqlite");
  const db = existsSync(path)
    ? await sqliteFixtureFrom(new Uint8Array(readFileSync(path)))
    : await sqliteFixture();
  const kernel = await GeometryKernel.create();
  return {
    catalog: new MapCatalog(db, kernel),
    publication: new MapPublication(db, kernel),
    assets: new MapAssets(files(join(directory, "map-assets"))),
    save() {
      writeFileSync(path, exportSqliteFixture(db));
    },
    close() {
      db.close();
      kernel.close();
    },
  };
}
