/* eslint-disable max-lines-per-function -- Playwright serializes the browser fixture as one isolated function. */
import type { Page } from "@playwright/test";
import type { DomainSnapshot, Grid } from "@atlas/domain";
import type { CompletedBoundary } from "@atlas/generation";

/** UI journeys receive small completed fields; algorithms run in the headless suite. */
export async function installGenerationFixture(page: Page, hold = false, terrain = false) {
  await page.addInitScript(
    ({ hold, terrain }) => {
      const pending = new Set<() => void>();
      Object.assign(window, {
        completeGenerationFixture() {
          for (const complete of [...pending]) complete();
        },
      });
      const NativeWorker = window.Worker;
      window.Worker = new Proxy(NativeWorker, {
        construct(target, args) {
          if (!String(args[0]).includes("generation.worker"))
            return Reflect.construct(target, args);
          let stopped = false;
          let complete: (() => void) | undefined;
          const worker = {
            onmessage: null as ((event: MessageEvent) => void) | null,
            terminate() {
              stopped = true;
              if (complete) pending.delete(complete);
            },
            postMessage(message: { snapshot: DomainSnapshot }) {
              // Pin the same input revision that a real worker receives through structured cloning.
              const snapshot = structuredClone(message.snapshot);
              complete = () => {
                if (complete) pending.delete(complete);
                if (stopped) return;
                const footprint = snapshot.scope.footprint;
                if (footprint.type !== "Polygon")
                  throw new Error("Fixture expects a polygon scope");
                const rings = footprint.coordinates.flat(2);
                const xs = rings.filter((_, i) => i % 2 === 0);
                const ys = rings.filter((_, i) => i % 2 === 1);
                const bounds: Grid["bounds"] = [
                  Math.min(...xs),
                  Math.min(...ys),
                  Math.max(...xs),
                  Math.max(...ys),
                ];
                const size = 16;
                const channels: Grid["channels"] = {};
                for (const name of [
                  "elevation",
                  "temperature",
                  "flow",
                  "water",
                  "naturalSurface",
                  "finalSurface",
                  ...snapshot.world.magicSystems!.flatMap((system) => [
                    `magic:${system.id}:history`,
                    `magic:${system.id}:coastalHistory`,
                  ]),
                ]) {
                  channels[name] = Float64Array.from({ length: size * size }, (_, i) => {
                    if (name === "water") return 0;
                    if (name !== "elevation" || !terrain) return i % size;
                    const x = (i % size) / (size - 1),
                      y = Math.floor(i / size) / (size - 1);
                    return -500 + 2400 * Math.exp(-8 * ((x - 0.6) ** 2 + (y - 0.6) ** 2));
                  });
                }
                const surface: Grid = {
                  id: "browser-fixture",
                  scope: { ...snapshot.scope, resolution: (bounds[2] - bounds[0]) / (size - 1) },
                  bounds,
                  width: size,
                  height: size,
                  active: new Uint8Array(size * size).fill(1),
                  measures: new Float64Array(size * size).fill(
                    ((bounds[2] - bounds[0]) * (bounds[3] - bounds[1])) / (size * size)
                  ),
                  channels,
                  units: Object.fromEntries(
                    Object.keys(channels).map((name) => [name, name === "elevation" ? "m" : "1"])
                  ),
                };
                const result: CompletedBoundary = {
                  kind: "final",
                  configurationHash: "browser-fixture",
                  ancestry: [],
                  state: {
                    domain: snapshot,
                    surface,
                    facts: new Set(Object.keys(channels)),
                    history: [],
                  },
                };
                worker.onmessage?.(
                  new MessageEvent("message", { data: { kind: "completed", result } })
                );
              };
              pending.add(complete);
              worker.onmessage?.(
                new MessageEvent("message", {
                  data: {
                    kind: "progress",
                    path: ["fixture"],
                    fraction: 0.5,
                    message: "Preparing test fields",
                  },
                })
              );
              if (!hold) queueMicrotask(complete);
            },
          };
          return worker;
        },
      });
    },
    { hold, terrain }
  );
}

export async function completeGenerationFixture(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { completeGenerationFixture(): void }).completeGenerationFixture()
  );
}
