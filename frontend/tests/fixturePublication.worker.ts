import type { MapRef } from "@atlas/map";
import fixture from "../../.artifacts/browser-fixture.json?raw";

/** Restore the existing supplied map, published once by Rust before the browser suite. */
export async function installFixtureMap() {
  const archive = JSON.parse(fixture) as {
    reference: MapRef;
    files: { path: string[]; bytes: number[] }[];
  };
  const root = await navigator.storage.getDirectory();
  for (const { path, bytes } of archive.files) {
    let directory = root;
    for (const name of path.slice(0, -1))
      directory = await directory.getDirectoryHandle(name, { create: true });
    const file = await directory.getFileHandle(path.at(-1)!, { create: true });
    const writable = await file.createWritable();
    await writable.write(new Uint8Array(bytes));
    await writable.close();
  }
  return archive.reference;
}
