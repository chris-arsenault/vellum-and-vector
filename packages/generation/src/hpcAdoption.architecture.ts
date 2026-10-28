import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

/** Architecture check: generation code must use the typed-array structures in
 * `@atlas/domain` (hpc) instead of the substitutes below. It is expected to fail until
 * every listed site is converted; its output is the conversion list. Run with
 * `make test-architecture`, not as part of the unit suite. */
interface Rule {
  pattern: RegExp;
  replacement: string;
  scope?: RegExp;
}
const rules: Rule[] = [
  { pattern: /new PriorityQueue</, replacement: "MonotoneHeap (monotone frontier) or KeyedHeap" },
  { pattern: /\bBoundedCandidates\b/, replacement: "TopK" },
  { pattern: /\borderedIndices\(/, replacement: "radixOrder" },
  { pattern: /new NumericalQueue\(/, replacement: "CellQueue" },
  { pattern: /new NumericalRecordQueue</, replacement: "RecordQueue" },
  { pattern: /new NumericalList\(/, replacement: "CellList or FloatList" },
  {
    pattern: /new Map<number,/,
    replacement: "groupByLabel, UnionFind or a dense Int32Array",
    scope: /canonry\//,
  },
  { pattern: /new Set<number>/, replacement: "BitSet or SmallIntSet", scope: /canonry\// },
  { pattern: /\.sort\(\(/, replacement: "radixOrder or a native typed-array sort()" },
  { pattern: /\.coords\[/, replacement: "LatticeIndex accessors (u, v, inverted by index)" },
  { pattern: /workingArray\([^)]*\)\.fill\(-1\)/, replacement: "EpochStamps" },
  {
    pattern: /JSON\.stringify\(/,
    replacement: "an integer key or groupByLabel",
    scope: /canonry\//,
  },
];
/** The substitutes themselves are not findings; they are deleted when their last user goes. */
const substitutes = new Set([
  "canonry/numericalQueue.ts",
  "canonry/numericalList.ts",
  "canonry/priorityQueue.ts",
  "canonry/numericalOrder.ts",
  "canonry/queueStorage.ts",
]);
function* sources(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "fixtures") yield* sources(path);
    } else if (/\.ts$/.test(entry.name) && !/\.test\.ts$|\.architecture\.ts$/.test(entry.name))
      yield path;
  }
}
export function hpcAdoptionFindings(root = __dirname) {
  const findings: string[] = [];
  for (const path of sources(root)) {
    const file = relative(root, path);
    if (substitutes.has(file)) continue;
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const rule of rules)
        if (rule.pattern.test(line) && (!rule.scope || rule.scope.test(file)))
          findings.push(`${file}:${index + 1}: ${line.trim()} -> ${rule.replacement}`);
    });
  }
  return findings;
}

it("generation uses the typed-array structures instead of object, Map and comparator substitutes", () => {
  const findings = hpcAdoptionFindings();
  const byFile = new Map<string, number>();
  for (const finding of findings) {
    const file = finding.slice(0, finding.indexOf(":"));
    byFile.set(file, (byFile.get(file) ?? 0) + 1);
  }
  const summary = [...byFile].sort((a, b) => b[1] - a[1]).map(([file, n]) => `${n}\t${file}`);
  expect(
    findings,
    `${findings.length} sites in ${byFile.size} files still use a substitute:\n${summary.join("\n")}\n\n${findings.join("\n")}`
  ).toEqual([]);
});
