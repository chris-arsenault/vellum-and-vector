import { expect, it } from "vitest";
import { renderingDiagnostics } from "./renderingDiagnostics";

it("counts tiles and summarizes the recent ones until counting starts again", () => {
  renderingDiagnostics.reset();
  let notified = 0;
  const stop = renderingDiagnostics.subscribe(() => notified++);
  renderingDiagnostics.pool(3, () => 2);
  for (const ms of [10, 30, 20]) {
    renderingDiagnostics.count("requested");
    renderingDiagnostics.drawn({ geography: 1, sample: ms, roundTrip: ms + 5 });
  }
  renderingDiagnostics.count("cancelled");
  renderingDiagnostics.count("reloads");
  const live = renderingDiagnostics.snapshot();
  expect(live).toMatchObject({ workers: 3, waiting: 2, requested: 3, drawn: 3, cancelled: 1 });
  expect(live.reloads).toBe(1);
  expect(live.sample).toEqual({ median: 20, slowest: 30 });
  expect(live.roundTrip).toEqual({ median: 25, slowest: 35 });
  // A snapshot is stable until something changes, as the store hook requires.
  expect(renderingDiagnostics.snapshot()).toBe(live);
  expect(notified).toBeGreaterThan(0);
  renderingDiagnostics.reset();
  expect(renderingDiagnostics.snapshot()).toMatchObject({ drawn: 0, recent: 0, reloads: 0 });
  stop();
});
