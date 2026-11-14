import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Current resource bytes on the backend volume; the application retains referenced resources during a job. */
export class NativeResourceFiles {
  constructor(private root: string) {}
  private path(key: string) {
    const parts = key.split("/").filter(Boolean);
    if (
      parts.length < 2 ||
      parts[0] !== "resources" ||
      parts.some((part) => part === "." || part === ".." || part.includes("\0"))
    )
      throw new Error("Numerical resource paths stay inside their local resource directory");
    return join(this.root, ...parts);
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async set(key: string, bytes: Uint8Array) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  async deletePrefix(key: string) {
    await rm(this.path(key), { recursive: true, force: true });
  }
  async snapshot(keys: string[]) {
    const paths = new Map(keys.map((key) => [key, this.path(key)]));
    for (const path of paths.values()) await access(path);
    let closed = false;
    return {
      read(key: string) {
        if (closed) throw new Error("This numerical input has been closed");
        const path = paths.get(key);
        // Open per read, like OPFS: a large field must not hold one descriptor per chunk.
        return path ? readFileSync(path) : undefined;
      },
      close() {
        closed = true;
        paths.clear();
      },
    };
  }
}
