import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { BinaryStore } from "./opfsStore";

/** Host filesystem transport for tests of the real resource encoding and readers. */
export function fileStoreFixture() {
  const directory = mkdtempSync(join(tmpdir(), "atlas-resources-"));
  const path = (key: string) => join(directory, key);
  const read = (key: string) =>
    existsSync(path(key)) ? new Uint8Array(readFileSync(path(key))) : undefined;
  const store: BinaryStore = {
    async get(key) {
      return read(key);
    },
    async set(key, bytes) {
      mkdirSync(dirname(path(key)), { recursive: true });
      writeFileSync(path(key), bytes);
    },
    async deletePrefix(prefix) {
      rmSync(path(prefix), { recursive: true, force: true });
    },
    async snapshot(keys) {
      const allowed = new Set(keys);
      return {
        read: (key) => (allowed.has(key) ? read(key) : undefined),
        close() {
          allowed.clear();
        },
      };
    },
  };
  return {
    store,
    close() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
