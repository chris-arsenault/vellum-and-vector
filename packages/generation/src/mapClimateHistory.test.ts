import { expect, it } from "vitest";
import { putChannel } from "@atlas/domain";
import {
  iceBalanceProcess,
  precipitationProcess,
  resetForcingProcess,
  temperatureProcess,
} from "./mapClimate";
import { magicStorageProcess, thermalMagicProcess } from "./mapMagic";
import { MapRunner } from "./mapRunner";
import type { GenerationState, ProcessSequence } from "./process";
import { configuration, epoch, invoke, landscape, options, registry, source } from "./mapFixtures";

it("transports moisture over a mountain barrier, accumulates snowy ice and retains retreat history", async () => {
  const initial = landscape(),
    snapshots: GenerationState[] = [],
    boundaries: string[] = [],
    config = configuration(
      [
        {
          kind: "epochs",
          id: "physical",
          resetFacts: ["heat", "temperature", "precipitation", "snowfall", "ice"],
          epochs: [
            epoch("warm", 2, { temperature: 8 }),
            epoch("glacial", 5, { temperature: -4 }),
            epoch("present", 2, { temperature: 8 }),
          ],
          body: [
            invoke(resetForcingProcess),
            invoke(temperatureProcess),
            invoke(precipitationProcess),
            invoke(iceBalanceProcess),
          ],
        },
      ],
      { incomingMoisture: 2, evaporation: 1, meltFactor: 0.15 }
    );
  const result = await new MapRunner(config, registry()).run(initial, {
    ...options,
    async saveBoundary(boundary) {
      boundaries.push(boundary.kind);
      if (boundary.kind === "epoch") snapshots.push(structuredClone(boundary.state));
    },
  });
  const [warm, glacial, present] = snapshots;
  expect(glacial.surface.channels.precipitation[2]).toBeGreaterThan(
    glacial.surface.channels.precipitation[3]
  );
  expect(glacial.surface.channels.ice[2]).toBeGreaterThan(glacial.surface.channels.ice[3]);
  expect(present.surface.channels.ice[1]).toBeLessThan(glacial.surface.channels.ice[1]);
  expect(present.surface.channels.maximumIce[1]).toBe(glacial.surface.channels.ice[1]);
  let previousVolume = 0;
  for (const snapshot of [warm, glacial, present]) {
    const cause = snapshot.history.at(-1)!.causes.find((cause) => cause.kind === "ice");
    if (cause?.kind !== "ice") throw new Error("Ice history is missing");
    expect(cause.remaining).toBeCloseTo(previousVolume + cause.accumulation - cause.meltwater, 7);
    previousVolume = cause.remaining;
  }
  expect(boundaries).toEqual(["epoch", "epoch", "epoch", "final"]);
  expect(result.state.history).toHaveLength(3);
  expect(result.state.history.every((entry) => !Object.hasOwn(entry, "surface"))).toBe(true);
  expect(initial.history).toEqual([]);
  expect(initial.surface.channels.ice).toBeUndefined();
});

it("refreshes thermal fields repeatedly without advancing zero-decay storage more than once", async () => {
  const initial = landscape();
  initial.domain.world.magic = [source(), source({ id: "fracture-core", propagation: "fracture" })];
  const body = [
    invoke(thermalMagicProcess, "before"),
    invoke(magicStorageProcess),
    invoke(thermalMagicProcess, "after"),
    invoke(thermalMagicProcess, "again"),
    invoke(temperatureProcess),
  ];
  const result = await new MapRunner(
    configuration([
      {
        kind: "epochs",
        id: "physical",
        resetFacts: ["heat", "temperature"],
        epochs: [epoch("warm", 2)],
        body,
      },
    ]),
    registry()
  ).run(initial, options);
  expect(result.state.surface.channels["magic:thermal-core:stored"][2]).toBe(4);
  expect(result.state.surface.channels.heat[2]).toBeCloseTo(8.8);
  expect(
    result.state.history[0].causes.filter(
      (cause) => cause.kind === "magic" && cause.process === "magic.advanceStorage"
    )
  ).toHaveLength(2);
  expect(result.state.surface.channels["magic:fracture-core:stored"][2]).toBeCloseTo(0.4);
});

it("decays retained influence when its source becomes inactive and separates heat and cold forcing", async () => {
  const initial = landscape();
  initial.domain.world.magic = [
    source({ decay: 0.5 }),
    source({ id: "cold-core", effect: "cold", storage: 0 }),
  ];
  const snapshots: GenerationState[] = [];
  await new MapRunner(
    configuration([
      {
        kind: "epochs",
        id: "physical",
        resetFacts: ["heat"],
        epochs: [
          epoch("warm", 1, { heatActivity: 1, coldActivity: 0 }),
          epoch("present", 2, { heatActivity: 0, coldActivity: 1 }),
        ],
        body: [
          invoke(thermalMagicProcess, "before"),
          invoke(magicStorageProcess),
          invoke(thermalMagicProcess, "after"),
          invoke(temperatureProcess),
        ],
      },
    ]),
    registry()
  ).run(initial, {
    ...options,
    async saveBoundary(boundary) {
      if (boundary.kind === "epoch") snapshots.push(structuredClone(boundary.state));
    },
  });
  expect(snapshots[1].surface.channels["magic:thermal-core:stored"][2]).toBeCloseTo(
    snapshots[0].surface.channels["magic:thermal-core:stored"][2] / 4,
    12
  );
  expect(snapshots[1].surface.channels.heat[2]).toBeLessThan(0);
  expect(snapshots[1].surface.channels.temperature[2]).toBeLessThan(
    snapshots[1].surface.channels.naturalTemperature[2]
  );
});

it("keeps nested history ancestry and does not activate physical sources from unrelated completed eras", async () => {
  const initial = landscape();
  initial.domain.world.magic = [source({ startsAtEpoch: 1, storage: 0 })];
  const snapshots: GenerationState[] = [];
  const result = await new MapRunner(
    configuration([
      {
        kind: "epochs",
        id: "physical",
        resetFacts: ["heat"],
        epochs: [epoch("warm", 4), epoch("present", 2)],
        body: [
          {
            kind: "epochs",
            id: "occupation",
            resetFacts: [],
            epochs: [epoch("settle", 1), epoch("leave", 1), epoch("return", 1)],
            body: [],
          },
          invoke(thermalMagicProcess),
        ],
      },
    ]),
    registry()
  ).run(initial, {
    ...options,
    async saveBoundary(boundary) {
      if (boundary.kind === "epoch" && boundary.ancestry.length === 1)
        snapshots.push(structuredClone(boundary.state));
    },
  });
  expect(snapshots[0].surface.channels.heat[2]).toBe(0);
  expect(snapshots[1].surface.channels.heat[2]).toBe(4);
  expect(
    result.state.history
      .filter((entry) => entry.ancestry.at(-1)?.id === "settle")
      .map((entry) => entry.ancestry.map((epoch) => epoch.id))
  ).toEqual([
    ["warm", "settle"],
    ["present", "settle"],
  ]);
});

it("rejects stale climatic inputs after a changing epoch instead of consuming old buffers", async () => {
  const initial = landscape();
  putChannel(initial.surface, "temperature", "celsius", new Float64Array(10).fill(-10));
  initial.facts.add("temperature");
  const config = configuration([
    {
      kind: "epochs",
      id: "physical",
      resetFacts: ["temperature"],
      epochs: [epoch("present", 1, { temperature: 10 })],
      body: [invoke(precipitationProcess)],
    },
  ]);
  await expect(new MapRunner(config, registry()).run(initial, options)).rejects.toThrow(
    /requires fresh temperature/
  );
  await expect(
    new MapRunner(configuration([invoke(temperatureProcess)]), registry()).run(initial, options)
  ).rejects.toThrow(/requires fresh heat/);
});

it("rejects duplicate elapsed-time advances and negative melt factors", async () => {
  const body = [
    invoke(resetForcingProcess),
    invoke(temperatureProcess),
    invoke(precipitationProcess),
    invoke(iceBalanceProcess, "first"),
    invoke(iceBalanceProcess, "second"),
  ];
  const wrap = (body: ProcessSequence) =>
    configuration([
      { kind: "epochs", id: "physical", resetFacts: [], epochs: [epoch("glacial", 1)], body },
    ]);
  await expect(new MapRunner(wrap(body), registry()).run(landscape(), options)).rejects.toThrow(
    /once per epoch/
  );
  await expect(
    new MapRunner(
      wrap(body.slice(0, 3).concat(invoke(iceBalanceProcess, "negative", { meltFactor: -1 }))),
      registry()
    ).run(landscape(), options)
  ).rejects.toThrow(/below its minimum/);
});

it("restarts a cancelled job from pinned inputs with identical geography and causal history", async () => {
  const initial = landscape();
  initial.domain.world.magic = [source({ decay: 0.1 })];
  const config = configuration([
    {
      kind: "epochs",
      id: "physical",
      resetFacts: ["heat", "temperature", "snowfall", "ice"],
      epochs: [epoch("glacial", 4, { temperature: -8 }), epoch("present", 2, { temperature: 2 })],
      body: [
        invoke(thermalMagicProcess, "before"),
        invoke(magicStorageProcess),
        invoke(thermalMagicProcess, "after"),
        invoke(temperatureProcess),
        invoke(precipitationProcess),
        invoke(iceBalanceProcess),
      ],
    },
  ]);
  const runner = new MapRunner(config, registry());
  let cancelled = false;
  await expect(
    runner.run(initial, {
      ...options,
      cancelled: () => cancelled,
      progress(path) {
        if (path.at(-1) === "climate.precipitation") cancelled = true;
      },
    })
  ).rejects.toThrow(/cancelled/);
  const restarted = await runner.run(initial, options),
    uninterrupted = await runner.run(initial, options);
  expect(restarted).toEqual(uninterrupted);
  expect(initial.surface.channels.heat).toBeUndefined();
  expect(initial.history).toEqual([]);
});

it("preserves completed history during ordinary present-day climate regeneration", async () => {
  const initial = landscape();
  initial.history.push({
    path: ["physical"],
    ancestry: [epoch("ancient", 100)],
    causes: [
      {
        kind: "domain",
        process: "geology",
        subjects: ["limestone"],
        description: "Inherited carbonate bedrock.",
      },
    ],
  });
  const result = await new MapRunner(
    configuration([invoke(resetForcingProcess), invoke(temperatureProcess)], { temperature: 5 }),
    registry()
  ).run(initial, options);
  expect(result.state.history).toEqual(initial.history);
  expect(result.state.causes?.[0].kind).toBe("climate");
});
