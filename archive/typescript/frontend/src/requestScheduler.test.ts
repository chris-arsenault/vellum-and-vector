import { expect, it } from "vitest";
import { createRequestScheduler } from "./requestScheduler";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

it("serves interactive requests before queued bulk work while preserving lane order", async () => {
  const scheduler = createRequestScheduler(),
    order: string[] = [];
  const job = (name: string) => async () => {
    order.push(name);
    await tick();
  };
  scheduler.enqueue("bulk", job("bulk-1"));
  scheduler.enqueue("bulk", job("bulk-2"));
  scheduler.enqueue("bulk", job("bulk-3"));
  scheduler.enqueue("interactive", job("read-1"));
  scheduler.enqueue("interactive", job("read-2"));
  while (scheduler.pending("bulk") || scheduler.pending("interactive")) await tick();
  await tick();
  expect(order).toEqual(["bulk-1", "read-1", "read-2", "bulk-2", "bulk-3"]);
});

it("keeps draining after a failed job", async () => {
  const scheduler = createRequestScheduler(),
    order: string[] = [];
  scheduler.enqueue("bulk", async () => {
    order.push("first");
    throw new Error("boom");
  });
  scheduler.enqueue("bulk", async () => {
    order.push("second");
  });
  for (let i = 0; i < 5; i++) await tick();
  expect(order).toEqual(["first", "second"]);
});
