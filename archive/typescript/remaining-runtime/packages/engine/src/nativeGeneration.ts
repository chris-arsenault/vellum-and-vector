import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { openNativeRecords } from "./nativeRecords";

export interface NativeGenerationPaths {
  resources: string;
  scratch: string;
  records: string;
  cacheBytes: number;
}
export interface NativeGenerationCallbacks {
  observe(kind: string, value: unknown): void | Promise<void>;
}
interface Message {
  kind: "ready" | "completed" | "failed" | "progress" | "diagnostic" | "preview" | "workProgress";
  value?: unknown;
  error?: string;
  fraction?: number;
  message?: string;
}
/** A run owns one native process. Its record handles remain live until publication finishes. */
export async function nativeGeneration(executable: string, paths: NativeGenerationPaths) {
  const started = deferred<void>();
  let callbacks: NativeGenerationCallbacks | undefined,
    completion: ReturnType<typeof deferred<unknown>> | undefined,
    failure: Error | undefined,
    completed = false;
  function fail(error: Error) {
    failure ??= error;
    started.reject(error);
    completion?.reject(error);
    transport.end();
  }
  const transport = pipe(executable, receive, fail, () => completed),
    send = transport.send;
  async function receive(message: Message) {
    if (message.kind === "ready") {
      started.resolve();
      return;
    }
    if (message.kind === "failed") {
      fail(new Error(message.error));
      return;
    }
    if (message.kind === "completed") {
      completed = true;
      completion?.resolve(message.value);
      return;
    }
    await callbacks?.observe(
      message.kind,
      message.kind === "workProgress" ? message : message.value
    );
  }
  send(paths);
  let records: ReturnType<typeof openNativeRecords>;
  try {
    await started.promise;
    records = openNativeRecords(paths.records);
  } catch (error) {
    await transport.close();
    throw error;
  }
  return {
    records,
    async run<T>(
      request: unknown,
      publication: unknown,
      observers: NativeGenerationCallbacks
    ): Promise<T> {
      if (failure) throw failure;
      if (completion) throw new Error("A native generation process runs once");
      callbacks = observers;
      completion = deferred<unknown>();
      send({ request, publication });
      const result = await completion.promise;
      records.refreshRevisions();
      return result as T;
    },
    cancel: () => send({ kind: "cancel" }),
    async close() {
      records.close();
      if (completed) send({ kind: "close" });
      else send({ kind: "cancel" });
      await transport.close();
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function pipe(
  executable: string,
  receive: (message: Message) => Promise<void>,
  fail: (error: Error) => void,
  completed: () => boolean
) {
  const process = spawn(executable, [], { stdio: ["pipe", "pipe", "inherit"] }),
    lines = createInterface({ input: process.stdout });
  process.on("error", fail);
  process.stdin.on("error", fail);
  const exited = new Promise<void>((resolve) =>
    process.once("close", (code) => {
      if (!completed()) fail(new Error(`Native generation closed (${code})`));
      resolve();
    })
  );
  let pending = Promise.resolve();
  lines.on("line", (line) => {
    pending = pending
      .then(() => receive(JSON.parse(line) as Message))
      .catch((error: unknown) => fail(error instanceof Error ? error : new Error(String(error))));
  });
  return {
    send: (value: unknown) => process.stdin.write(`${JSON.stringify(value)}\n`),
    end: () => process.stdin.end(),
    async close() {
      process.stdin.end();
      await exited;
      lines.close();
    },
  };
}
