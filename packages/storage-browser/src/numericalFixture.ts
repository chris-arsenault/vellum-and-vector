import { closeSync, fsyncSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PagedArena } from "./pagedArena";

/** Paged by default so storage tests exercise the overflow path; production and the shared
 * generation run pass a resident budget. */
export function arenaFixture(decodedBytes = 32_768, pageSamples = 256, residentBytes = 0) {
  const directory = mkdtempSync(join(tmpdir(), "atlas-physical-")),
    fd = openSync(join(directory, "work.bin"), "w+");
  const arena = new PagedArena(
    {
      read: (bytes, offset) => readSync(fd, bytes, 0, bytes.byteLength, offset),
      write: (bytes, offset) => writeSync(fd, bytes, 0, bytes.byteLength, offset),
      flush: () => fsyncSync(fd),
      close: () => closeSync(fd),
    },
    decodedBytes,
    pageSamples,
    residentBytes
  );
  return {
    arena,
    close() {
      arena.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
}
