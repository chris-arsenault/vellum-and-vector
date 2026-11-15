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
];
const numericFiles = ["flow_graph.rs", "climate.rs", "noise.rs", "prominence.rs"];
function rustFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? rustFiles(path) : path.endsWith(".rs") ? [path] : [];
  });
}
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
  it("the numeric structure scope actually covers Rust sources", () => {
    const files = [
      ...numericOwners.flatMap((owner) =>
        rustFiles(join(root, "crates/atlas-generation/src", owner))
      ),
      ...numericFiles.map((file) => join(root, "crates/atlas-generation/src", file)),
    ];
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap((path) => numericSubstitutes(path, readFileSync(path, "utf8")))).toEqual(
      []
    );
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
          ? ["serde", "serde_json", "ts-rs"]
          : name === "atlas-names"
            ? ["serde", "serde_json"]
            : [
                "atlas-map",
                "atlas-names",
                "serde",
                "serde_json",
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
