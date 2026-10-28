import { expect, test } from "vitest";
import { openStorageSession, type SessionLocks } from "./storageSession";

/** A lock manager that records the order of exclusive, collection and shared phases. */
function fakeLocks(exclusiveAvailable: boolean) {
  const events: string[] = [];
  const locks: SessionLocks = {
    async request(name, options, callback) {
      const mode = options.mode ?? "exclusive";
      events.push(`${mode}:begin`);
      const lock = mode === "exclusive" && !exclusiveAvailable ? null : ({ name, mode } as Lock);
      const result = await callback(lock);
      events.push(`${mode}:end`);
      return result;
    },
  };
  return { locks, events };
}

test("collection runs inside the exclusive lock, before the shared lease is granted", async () => {
  const { locks, events } = fakeLocks(true);
  const release = await openStorageSession(async () => {
    events.push("collect");
  }, locks);
  expect(events.slice(0, 4)).toEqual([
    "exclusive:begin",
    "collect",
    "shared:begin",
    "exclusive:end",
  ]);
  await release();
  expect(events.at(-1)).toBe("shared:end");
});

test("another live tab skips collection but still acquires the shared lease", async () => {
  const { locks, events } = fakeLocks(false);
  const release = await openStorageSession(async () => {
    events.push("collect");
  }, locks);
  expect(events).not.toContain("collect");
  expect(events).toContain("shared:begin");
  await release();
});
