import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { NavigationOperations, NavigationOperation } from "./navigation";
export { NativeResourceFiles } from "./nativeResourceFiles";
export {
  nativeGeneration,
  type NativeGenerationPaths,
  type NativeGenerationCallbacks,
} from "./nativeGeneration";

/** One native Rust worker per backend host; a failed worker never falls back to browser compute. */
export function nativeNavigation(
  executable: string
): NavigationOperations & { close(): Promise<void> } {
  const process = spawn(executable, [], { stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let sequence = 0;
  let failure: Error | null = null;
  const fail = (error: Error) => {
    failure = error;
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  };
  process.on("error", fail);
  process.stdin.on("error", fail);
  const exited = new Promise<void>((resolve) =>
    process.once("close", (code) => {
      fail(new Error(`Native map worker closed (${code})`));
      resolve();
    })
  );
  const lines = createInterface({ input: process.stdout });
  lines.on("line", (line) => {
    try {
      const reply = JSON.parse(line) as { id: number; value?: unknown; error?: string };
      const call = pending.get(reply.id);
      if (!call) throw new Error("Native worker returned an unknown request");
      pending.delete(reply.id);
      if (reply.error) call.reject(new Error(reply.error));
      else call.resolve(reply.value);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      process.kill();
    }
  });
  function run<T>(operation: NavigationOperation): Promise<T> {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      process.stdin.write(`${JSON.stringify({ id, operation })}\n`, (error) => {
        if (error) {
          pending.delete(id);
          reject(error);
        }
      });
    });
  }
  return {
    choices: (input, query) => run({ method: "choices", params: [input, query] }),
    draw: (input, drawing) => run({ method: "draw", params: [input, drawing] }),
    change: (map, state, change) => run({ method: "change", params: [map, state, change] }),
    async close() {
      process.stdin.end();
      await exited;
      lines.close();
    },
  };
}
