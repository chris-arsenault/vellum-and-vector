export interface SessionLocks {
  request<T>(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<T>
  ): Promise<T>;
}
/** A shared tab lease protects generation and render workers too. Cleanup never waits for
 * another tab to finish and never treats an unsaved catalog as a recoverable session. */
export async function openStorageSession(
  collect?: () => Promise<void>,
  locks: SessionLocks = navigator.locks
) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired!: () => void;
  let reject!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, fail) => {
    acquired = resolve;
    reject = fail;
  });
  let lease: Promise<void>;
  await locks.request("atlas-storage-session", { ifAvailable: true }, async (lock) => {
    if (lock && collect) await collect();
    // Queue the shared lease before releasing exclusivity, so another collector cannot
    // overtake this tab after it starts constructing a workspace.
    lease = locks
      .request("atlas-storage-session", { mode: "shared" }, async () => {
        acquired();
        await released;
      })
      .then(() => {});
    void lease.catch(reject);
  });
  await ready;
  return async () => {
    release();
    await lease;
  };
}
