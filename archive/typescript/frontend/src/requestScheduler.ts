/** Two FIFO lanes over one executor. Interactive requests (the editor's own port) run before
 * bulk requests (generation and render ports), so a scene read never waits behind a
 * publication backlog; order within each lane is preserved. */
export type Lane = "interactive" | "bulk";
export function createRequestScheduler() {
  const lanes: Record<Lane, (() => Promise<void>)[]> = { interactive: [], bulk: [] };
  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        const job = lanes.interactive.shift() ?? lanes.bulk.shift();
        if (!job) return;
        try {
          await job();
        } catch {
          // Each job reports its own failure to its requester; the lanes keep moving.
        }
      }
    } finally {
      draining = false;
    }
  }
  return {
    enqueue(lane: Lane, job: () => Promise<void>) {
      lanes[lane].push(job);
      void drain();
    },
    pending(lane: Lane) {
      return lanes[lane].length;
    },
  };
}
