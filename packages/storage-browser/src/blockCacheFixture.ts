import { closeSync, fsyncSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlockCache, BlockScratch } from "@atlas/domain";

/** A block cache over a temporary scratch file, evicting by default so storage tests
 * exercise the spill path; production passes a resident budget. */
export function blockCacheFixture(budgetBytes = 256 * 1024) {
  const directory = mkdtempSync(join(tmpdir(), "atlas-blocks-")),
    fd = openSync(join(directory, "work.blocks"), "w+");
  const scratch = new BlockScratch({
      read: (bytes, offset) => readSync(fd, bytes, 0, bytes.byteLength, offset),
      write: (bytes, offset) => writeSync(fd, bytes, 0, bytes.byteLength, offset),
      flush: () => fsyncSync(fd),
      close: () => closeSync(fd),
    }),
    cache = new BlockCache(budgetBytes, scratch);
  return {
    cache,
    scratch,
    close() {
      scratch.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
}
