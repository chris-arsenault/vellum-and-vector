import { closeSync, fsyncSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PagedArena } from "./pagedArena";

export function arenaFixture(decodedBytes = 32_768, pageSamples = 256) {
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
    pageSamples
  );
  return {
    arena,
    close() {
      arena.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
}
