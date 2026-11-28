import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../../..");
const numericOwners = [
  "hpc",
  "rock",
  "water",
  "human",
  "field",
  "transport",
  "publication",
  "processes",
  "tectonics",
  "metric",
  "magic",
  "reconstruction",
  "ecology",
  "chance",
];
const numericFiles = ["flow_graph.rs", "climate.rs", "noise.rs", "prominence.rs"];
function rustFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? rustFiles(path) : path.endsWith(".rs") ? [path] : [];
  });
}
// These adapters consume the field catalogue's declared roles. Raw kind decoding
// and lookup of full entries belong to the field catalogue itself.
function fieldIdentityReads(source: string): string[] {
  const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  return Array.from(
    code.matchAll(
      /\bkinds\s*::|\buse\s+[^;]+?\bkinds\b|\.\s*for_feature\s*\(|\bfeature\s*\.\s*kind\b|"(?:poi|placeKind)"/g
    ),
    ([read]) => read
  );
}
// This check flags keyed containers and comparator sorts in numerical code so a person
// looks at each one. It is a prompt for critical thought, not a ban. Per-cell state over
// a whole lattice belongs in dense cell-indexed storage. Sparse data (the cells a walk has
// visited, a few sources, records keyed by identity) belongs in the structure that fits
// it, a set, map or sort included, with an `hpc-exempt:` reason. Replacing a correct
// sparse structure with a map-sized array or a linear scan turns local work into
// whole-map work, which is a performance defect, not compliance.
const numericGuidance =
  "Each listed line uses a keyed container or comparator sort in numerical code. Decide " +
  "what the data is: per-cell state over the lattice belongs in dense cell-indexed storage; " +
  "sparse or identity-keyed data keeps its set, map or sort with an `hpc-exempt:` reason. " +
  "Do not swap a correct sparse structure for a map-sized array or a linear scan.";
function numericSubstitutes(path: string, text: string) {
  if (
    !numericOwners.some((owner) => path.includes(`/${owner}/`)) &&
    !numericFiles.some((file) => path.endsWith(`/${file}`))
  )
    return [];
  const lines = text.split("\n");
  return lines.flatMap((line, index) =>
    /\b(HashMap|HashSet|BTreeMap|BTreeSet)\b|\.sort(_unstable)?_by(_key)?\s*\(/.test(line) &&
    ![line, lines[index - 1] ?? ""].some((text) => text.includes("hpc-exempt:"))
      ? [`${path}:${index + 1}`]
      : []
  );
}

describe("Rust foundation architecture", () => {
  it("recurring town processes ask for policies without reading the settlement identity", () => {
    const files = rustFiles(join(root, "crates/atlas-generation/src/processes/town"));
    for (const file of files) {
      const source = readFileSync(file, "utf8").split("#[cfg(test)]")[0];
      const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
      expect(code, file).not.toMatch(/\bTemplate\b|\.\s*template\s*\.\s*selected\b/);
    }
  });
  it("town and trail adapters consume field POI roles without decoding concrete field identities", () => {
    const generation = join(root, "crates/atlas-generation/src");
    const adapters = [
      ...rustFiles(join(generation, "atlas/town")),
      ...rustFiles(join(generation, "processes/town")),
      join(generation, "atlas/state/real_scale_trails.rs"),
    ];
    expect(
      adapters.flatMap((file) =>
        fieldIdentityReads(readFileSync(file, "utf8")).map((read) => `${file}: ${read}`)
      )
    ).toEqual([]);
    expect(
      fieldIdentityReads('use field::poi::{kinds as k}; if feature.kind == "farm" {}')
    ).toEqual(["use field::poi::{kinds", "feature.kind"]);
    expect(fieldIdentityReads('attrs.get("poi").or_else(|| lookup.for_feature(f))')).toEqual([
      '"poi"',
      ".for_feature(",
    ]);
  });
  it("registers every human owner mutation through the opaque command boundary", () => {
    const human = join(root, "crates/atlas-generation/src/human");
    const offered = ["owner.rs", "loss.rs", "carry.rs"].flatMap((name) =>
      [...readFileSync(join(human, name), "utf8").matchAll(/pub\(super\) fn (\w+)\(/g)].map(
        (match) => match[1]
      )
    );
    const operations = readFileSync(join(human, "operations.rs"), "utf8");
    const registered = [...operations.matchAll(/owner\.(\w+)\(/g)].map((match) => match[1]);
    expect(offered.length).toBeGreaterThan(0);
    expect(registered.sort()).toEqual(offered.sort());
    expect(operations).toContain("Command::with_inputs");
  });
  it("geology and river rules take their chance from the chance library", () => {
    // The library in `chance.rs` was taken out of these rules and is proven by them. A
    // rule here that reaches past it for the hash or the noise octaves writes its own
    // way of drawing again, and the library's contract stops being the one in use.
    const generation = join(root, "crates/atlas-generation/src");
    const rules = [
      ...["water", "rock", "tectonics", "reconstruction"].flatMap((owner) =>
        rustFiles(join(generation, owner))
      ),
      ...["orogeny", "fractures", "refinement", "river_drawing", "impacts"].flatMap((owner) =>
        rustFiles(join(generation, "field", owner))
      ),
      ...["uplift.rs", "plumes.rs", "coastal_detail.rs", "crust_queries.rs"].map((file) =>
        join(generation, "field", file)
      ),
    ];
    expect(rules.length).toBeGreaterThan(100);
    const lowLevel =
      /\b(hash_unit|hash_signed|fractal_noise|unit_noise|mesh_noise|world_noise)\b/;
    expect(
      rules.filter((file) =>
        lowLevel.test(readFileSync(file, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""))
      )
    ).toEqual([]);
  });
  it("no rule adds a draw or a noise call of its own outside the chance library", () => {
    // Rules written before the library still call the hash and the noise octaves
    // directly, as many times as listed here. A count may fall as a rule is moved onto
    // the library and may never rise, and a file not listed may hold none. A new rule
    // takes its chance from `crates/atlas-generation/src/chance.rs`.
    const generation = join(root, "crates/atlas-generation/src");
    const before: Record<string, number> = {
      "atlas/regional/city/works.rs": 1,
      "ecology/disturbance.rs": 1,
      "ecology/establishment.rs": 1,
      "ecology/ignition.rs": 3,
      "field/climate/atmosphere.rs": 2,
      "field/climate/currents/mod.rs": 2,
      "field/landmarks/roster.rs": 6,
      "field/poi/fall_origins.rs": 2,
      "field/poi/fall_shape.rs": 2,
      "field/poi/fall_size.rs": 2,
      "field/poi/names.rs": 2,
      "field/poi/peak.rs": 3,
      "field/poi/peak_origins.rs": 3,
      "field/sea_ice.rs": 2,
      "field/warmth.rs": 5,
      "magic/confluences/actions.rs": 2,
      "magic/material.rs": 2,
      "magic/propagation/beams.rs": 4,
      "magic/propagation/cold.rs": 2,
      "magic/propagation/ocean.rs": 2,
      "magic/regions/readers.rs": 4,
      "magic/sources/geothermal.rs": 2,
      "magic/veil/mod.rs": 2,
      "processes/town/construction.rs": 7,
      "processes/town/urban/activity.rs": 1,
      "processes/town/urban/character.rs": 3,
      "processes/town/urban/circulation.rs": 1,
      "processes/town/urban/investment.rs": 1,
      "processes/town/urban/journeys.rs": 1,
      "processes/town/urban/landscape.rs": 1,
      "processes/town/urban/places.rs": 2,
      "processes/town/urban/programs.rs": 1,
      "processes/town/urban/programs/origins.rs": 2,
      "town/catalogue/development.rs": 1,
      "town/catalogue/works/design.rs": 2,
      "town/founding.rs": 4,
      "town/founding/district.rs": 3,
      "town/land_sites.rs": 2,
      "town/major_works.rs": 4,
      "town/major_works/construction.rs": 3,
      "town/order.rs": 1,
      "town/plots.rs": 1,
    };
    const lowLevel = /\b(hash_unit|hash_signed|fractal_noise|unit_noise|mesh_noise|world_noise)\b/g;
    const grown = rustFiles(generation).flatMap((file) => {
      const path = file.slice(generation.length + 1);
      if (path === "noise.rs" || path === "chance.rs" || path.startsWith("chance/")) return [];
      const code = readFileSync(file, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
      const uses = code.match(lowLevel)?.length ?? 0;
      return uses > (before[path] ?? 0) ? [`${path}: ${uses} (was ${before[path] ?? 0})`] : [];
    });
    expect(
      grown,
      "These files draw or read noise directly more often than before. Take chance from " +
        "crates/atlas-generation/src/chance.rs instead: its 'What to reach for' table names " +
        "the piece for a choice, a spread, a line, a patchy share, a size or a level that " +
        "wanders, and chance/examples.rs shows a rule built from them."
    ).toEqual([]);
  });
  it("the numeric structure scope actually covers Rust sources", () => {
    const files = [
      ...numericOwners.flatMap((owner) =>
        rustFiles(join(root, "crates/atlas-generation/src", owner))
      ),
      ...numericFiles.map((file) => join(root, "crates/atlas-generation/src", file)),
    ];
    expect(files.length).toBeGreaterThan(0);
    expect(
      files.flatMap((path) => numericSubstitutes(path, readFileSync(path, "utf8"))),
      numericGuidance
    ).toEqual([]);
  });
  it("rejects numerical substitutes while allowing query and cache metadata", () => {
    expect(numericSubstitutes("/hpc/index.rs", "use std::collections::HashMap;")).toHaveLength(1);
    expect(numericSubstitutes("/hpc/order.rs", "values.sort_by(|a,b| a.cmp(b));")).toHaveLength(1);
    expect(numericSubstitutes("/execution.rs", "use std::collections::HashMap;")).toEqual([]);
    expect(numericSubstitutes("/rock/cargo.rs", "use std::collections::BTreeMap;")).toHaveLength(1);
    expect(numericSubstitutes("/water/column.rs", "use std::collections::HashMap;")).toHaveLength(
      1
    );
    expect(numericSubstitutes("/human/carry.rs", "use std::collections::HashMap;")).toHaveLength(1);
    expect(numericSubstitutes("/flow_graph.rs", "use std::collections::HashMap;")).toHaveLength(1);
    for (const path of ["/processes/creep.rs", "/tectonics/motion.rs", "/metric/operator.rs"])
      expect(numericSubstitutes(path, "use std::collections::HashMap;")).toHaveLength(1);
    expect(numericSubstitutes("/field/shared.rs", "use std::collections::HashMap;")).toHaveLength(
      1
    );
  });
});

describe("Rust crate dependency boundary", () => {
  it("map and generation crates depend on values, not host adapters or services", () => {
    const metadata = JSON.parse(
      execFileSync("cargo", ["metadata", "--locked", "--no-deps", "--format-version", "1"], {
        cwd: root,
        encoding: "utf8",
      })
    ) as {
      packages: { name: string; dependencies: { name: string; kind: string | null }[] }[];
    };
    for (const name of ["atlas-map", "atlas-names", "atlas-generation"]) {
      const pkg = metadata.packages.find((candidate) => candidate.name === name);
      expect(pkg, name).toBeDefined();
      const allowed =
        name === "atlas-map"
          ? ["serde", "serde_json", "ts-rs", "rstar"] // rstar: in-memory bounds index; no host capability.
          : name === "atlas-names"
            ? ["serde", "serde_json"]
            : [
                "atlas-map",
                "atlas-names",
                "serde",
                "serde_json",
                "ciborium", // Value encoding for owner mementos; no host or storage service.
                "smallvec", // Inline numeric parcel storage; no host capability.
                "ts-rs",
                "bytemuck",
                "tiff",
                "uuid",
                "rayon",
              ];
      expect(
        pkg!.dependencies.filter((dep) => dep.kind === null && !allowed.includes(dep.name))
      ).toEqual([]);
    }
  });
});
