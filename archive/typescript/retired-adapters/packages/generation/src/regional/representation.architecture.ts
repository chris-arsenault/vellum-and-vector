import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

/**
 * Architecture check: the regional namespace runs on the generator's own field and lattice.
 * It defines no second grid, channel vocabulary or unit table: no `RegularGrid` surface, no
 * grid-arithmetic neighbours, no regional channel allocator and no per-channel unit records.
 * A site with a reason carries `// representation-exempt: <reason>` on its line or the line
 * before. Run with `make test-architecture`.
 */
const rules: { pattern: RegExp; replacement: string }[] = [
  { pattern: /\bRegularGrid\b/, replacement: "the physical field on its lattice" },
  { pattern: /\bgridNeighbors\(/, replacement: "mesh.degree/neighbor" },
  { pattern: /\bnaturalChannel\(/, replacement: "naturalBand" },
  { pattern: /\bchannel\(state,/, replacement: "a field band" },
  { pattern: /\.units\[/, replacement: "the field's native units" },
  { pattern: /\bgridPosition\(/, replacement: "positionOf(mesh, i)" },
  { pattern: /surface\.channels\.[a-zA-Z]+\.set\(/, replacement: "a field band write" },
];
function* sources(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$|\.architecture\.ts$/.test(entry.name))
      yield path;
  }
}
export function representationFindings(root = __dirname) {
  const findings: string[] = [];
  for (const path of sources(root)) {
    const file = relative(root, path),
      lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (
        /representation-exempt:/.test(line) ||
        /representation-exempt:/.test(lines[index - 1] ?? "")
      )
        return;
      for (const rule of rules)
        if (rule.pattern.test(line))
          findings.push(`${file}:${index + 1}: ${line.trim()} -> use ${rule.replacement}`);
    });
  }
  return findings;
}
it("keeps the regional namespace on the generator's field and lattice", () => {
  expect(representationFindings()).toEqual([]);
});
