import { expect, it } from "vitest";
import { lengthAuthorityFindings } from "./lengthAuthorityCheck";

const check = (text: string) => lengthAuthorityFindings([{ file: "supplied.ts", text }]);
it("surfaces unclassified local dimensional names without pretending names prove units", () => {
  expect(check("const fixed = 300; const sourceReach = fixed;").map((item) => item.rule)).toEqual([
    "fixed-dimension",
  ]);
  expect(check("const sourceReach = 300;")[0].certainty).toBe("inventory");
});
it("rejects a raw dimensional definition even when its constant comes from another module", () => {
  const result = lengthAuthorityFindings([
    { file: "controls.ts", text: "export const raw = 300;" },
    {
      file: "settings.ts",
      text: `import { MapScale } from "@atlas/domain";
      import { raw as supplied } from "./controls";
      const definitions = MapScale.definitions({ radius: supplied });`,
    },
  ]);
  expect(result.map(({ rule, certainty }) => ({ rule, certainty }))).toEqual([
    { rule: "fixed-dimension", certainty: "boundary" },
  ]);
});
it("finds raw overrides through relative declaration keys even without a dimensional suffix", () => {
  const result = check(`import { MapScale as Scale } from "@atlas/domain";
    const settings = Scale.definitions({ SedimentCarry: Scale.length(0.02) });
    const raw = 600; profile.SedimentCarry = raw;`);
  expect(result.map((item) => item.rule)).toEqual(["fixed-dimension"]);
});
it("rejects fixed lengths through codec aliases and local aliases of the native unit factor", () => {
  const result = check(`import { units as encoded } from "./world/math";
    import { toUnits as decoded } from "./world/math";
    encoded(500); decoded(500);
    const factor = 1024; const convert = (value: number) => value * factor;`);
  expect(result.map((item) => item.rule)).toEqual([
    "fixed-dimension",
    "fixed-dimension",
    "native-converter",
  ]);
});
it("rejects aliased imports and reexports of obsolete independent scalers", () => {
  expect(
    check(`import { continentalWorldProfile as scaled } from "./worldScale";
    export { continentalWorldProfile as region } from "./worldScale";`).map((item) => item.rule)
  ).toEqual(["legacy-converter", "legacy-converter"]);
});
it("rejects reference conversions even inside obsolete versioned imports", () => {
  expect(
    check(`import { MapScale } from "@atlas/domain";
    export function migrateRecipeLengths(input: unknown) {
      const value = input as { schemaVersion: number };
      if (value.schemaVersion !== 1) return input;
      return MapScale.reference().fraction(300);
    }`).map((item) => item.rule)
  ).toEqual(["reference-frame"]);
});
it("rejects an actual runtime reference fallback through a class alias", () => {
  expect(
    check(`import { MapScale as M } from "@atlas/domain";
    const Alias = M; const scale = Alias.reference();`).map((item) => item.rule)
  ).toEqual(["reference-frame"]);
});
it("allows relative declarations, fraction overrides, measured data and physical arithmetic", () => {
  expect(
    check(`import { MapScale } from "@atlas/domain";
    const definition = MapScale.definitions({ radius: MapScale.length(0.01) });
    const profile = scale.resolve(definition, { radius: 0.03 });
    const depth = measured.top - measured.bottom;
    const moved = flow * span; const native = MapScale.native(depth);
    const empty = { depth: 0 };`)
  ).toEqual([]);
});
it("rejects absolute-unit parameter schemas but permits relative schemas and measured channels", () => {
  expect(
    check(`const parameters = {
    relief: { type: "number", unit: "metre", default: 100 },
    speed: { type: "number", unit: "map-span/year", default: 0.002 },
  }; const channel = { unit: "metre", minimum: 0 };`).map((item) => item.rule)
  ).toEqual(["absolute-parameter"]);
});
it("rejects shorthand geographic units in parameter defaults", () => {
  const found = check(`const atlasParameters = {
    cityReach: { type: "number", unit: "km", default: 200 },
    rainfall: { type: "number", unit: "mm/year", default: 300 },
    depth: { type: "number", unit: "m", default: 5 },
    fraction: { type: "number", unit: "m/m", default: 0.4 },
  };`);
  expect(found.map((item) => item.rule)).toEqual(Array(3).fill("absolute-parameter"));
});
it("allows physical display metadata only when generated defaults carry relative descriptors", () => {
  const found = check(`import { MapScale } from "@atlas/domain";
    const generatedLength = (fraction: number) => ({ default: MapScale.length(fraction) });
    const parameters = {
      measured: { unit: "m", default: 300, generated: generatedLength(0.001) },
      volume: { unit: "m³/s", default: 500, generated: { default: MapScale.volume(0.002) } },
      bypass: { unit: "km", default: 200, generated: { default: 200 } },
    };`);
  expect(found.map((item) => item.rule)).toEqual(["absolute-parameter"]);
});
it("rejects raw descriptor-array overrides and indexed constant-array aliases", () => {
  const found = check(`import { MapScale } from "@atlas/domain";
    const definition = MapScale.definitions({ bands: [MapScale.length(0.01)] });
    const fixed = [100000, 200000] as const;
    profile.bands = [100000];
    profile.bands = fixed;
    profile.bands = fixed[index];
    const profile = scale.resolve(definition, { bands: [0.01, 0.02] });`);
  expect(found.map(({ rule, certainty }) => ({ rule, certainty }))).toEqual(
    Array(3).fill({ rule: "fixed-dimension", certainty: "boundary" })
  );
});
it("rejects fixed generated dimensions passed directly to the shared codec", () => {
  expect(
    check(`import { MapScale as Scale } from "@atlas/domain";
    const radius = Scale.native(500);`).map((item) => item.rule)
  ).toEqual(["fixed-dimension"]);
});
it("keeps byte arithmetic in the review inventory rather than treating it as a ground codec", () => {
  const found = check("const decodedCacheBytes = 32 * 1024 * 1024;");
  expect(found).toHaveLength(2);
  expect(found.every((item) => item.certainty === "inventory")).toBe(true);
});
it("classifies explicit non-length controls without allowing their comments to waive a codec bypass", () => {
  const found = check(`import { MapScale } from "@atlas/domain";
    const definitions = MapScale.definitions({
      // length-unit: degrees — angular spread.
      BeltWidth: 15,
      // length-unit: ratio — this comment cannot change the codec call.
      EncodedDepth: MapScale.native(500),
    });`);
  expect(found.map(({ rule, certainty }) => ({ rule, certainty }))).toEqual([
    { rule: "fixed-dimension", certainty: "inventory" },
    { rule: "fixed-dimension", certainty: "boundary" },
  ]);
});
it("rejects new top-level generated lengths and requires declared fractions or non-length units", () => {
  const found = lengthAuthorityFindings([
    {
      file: "packages/generation/src/newProcess.ts",
      text: `
    const reach = 250000;
    // length-unit: fraction — resolved by the shared caller.
    const smallerReach = 0.002;
    // length-unit: count — number of graph edges.
    const pathLength = 3;
  `,
    },
  ]);
  expect(found.map((item) => item.certainty)).toEqual(["boundary", "inventory", "inventory"]);
});
it("follows arithmetic constant aliases without treating measured arithmetic as a constant", () => {
  const found = lengthAuthorityFindings([
    {
      file: "packages/generation/src/newProcess.ts",
      text: `
    const kilometre = 1000; const reach = 250 * kilometre;
    const encodeHeight = (height: number) => height * (2 ** 10);
    const observedDepth = actual.top - actual.bottom;
  `,
    },
  ]);
  expect(found.map((item) => item.rule)).toEqual(["fixed-dimension", "native-converter"]);
});

it("rejects fixed dimensions passed through each geographic codec in a definition", () => {
  for (const expression of [
    'MapScale.metres(200, "km")',
    'MapScale.inUnits(200, "km")',
    'MapScale.areaUnits(200, "km2", "m2")',
    'MapScale.volumeUnits(200, "km3", "m3")',
  ]) {
    const found = check(`import { MapScale } from "@atlas/domain";
      const settings = MapScale.definitions({ extent: ${expression} });`);
    expect(found.some((item) => item.certainty === "boundary")).toBe(true);
  }
});

it("rejects indexed writes through literal keys, aliases, loops and parameter unions", () => {
  const found = check(`import { MapScale } from "@atlas/domain";
    const carry = MapScale.length(0.02);
    const settings = MapScale.definitions({ SedimentCarry: carry });
    profile["SedimentCarry"] = 600;
    const key = "SedimentCarry"; profile[key] = 700;
    for (const field of ["SedimentCarry"] as const) profile[field] = 800;
    function update(field: "SedimentCarry" | "count") { profile[field] = 900; }`);
  expect(found.filter((item) => item.certainty === "boundary")).toHaveLength(4);
});

it("follows named and spread definition objects across module boundaries", () => {
  const found = lengthAuthorityFindings([
    { file: "controls.ts", text: "export const fixed = { radius: 200000 };" },
    {
      file: "settings.ts",
      text: `import { MapScale } from "@atlas/domain";
      import { fixed } from "./controls";
      const settings = MapScale.definitions({ ...fixed });`,
    },
  ]);
  expect(found.map((item) => item.certainty)).toEqual(["boundary"]);
  const nested = check(`import { MapScale } from "@atlas/domain";
    const fixed = { radius: 200000 };
    const settings = MapScale.definitions({ layers: [fixed] });`);
  expect(nested.map((item) => item.certainty)).toEqual(["boundary"]);
});

it("keeps constants in their lexical scopes and respects parameter shadowing", () => {
  const found = check(`import { MapScale } from "@atlas/domain";
    const fixed = 300;
    const settings = MapScale.definitions({ radius: fixed });
    function unrelated() { const fixed = measured; }
    function observed(fixed: number) { return MapScale.definitions({ radius: fixed }); }`);
  expect(found.map((item) => item.certainty)).toEqual(["boundary"]);
});
