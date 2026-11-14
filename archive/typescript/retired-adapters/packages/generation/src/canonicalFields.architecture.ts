import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { sourceFiles } from "./architectureReach";
import { physicalChannels } from "./world/atlasChannels";
import { derived } from "./world/atlasPublications";
import { canonicalPhysicalFields } from "@atlas/domain";

const root = join(__dirname, "../../.."),
  domain = join(root, "packages/domain/src"),
  generation = join(root, "packages/generation/src");
const roots = ["domain", "generation", "application", "storage-browser"]
  .flatMap((name) => [...sourceFiles(join(root, "packages", name, "src"))])
  .concat([...sourceFiles(join(root, "frontend/src"))])
  .filter((file) => !/\/(?:harness|testSupport)\/|(?:Fixture|Fixtures)\.tsx?$/.test(file))
  .sort();
const configPath = join(root, "frontend/tsconfig.json"),
  configuration = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, ts.sys.readFile).config,
    ts.sys,
    dirname(configPath)
  );
const contractPath = join(generation, "__canonical_field_contract.ts");
const contract = `
import type { PhysicalField, PhysicalBufferName } from "./world/field";
declare const map: PhysicalField;
declare const name: PhysicalBufferName;
declare const group: { cover: "GrassCover" | "TreeCover" };
declare const prefix: "Grass" | "Tree";
declare const unrelated: { Elevation: number };
map.Elevation;
map["Elevation"];
map[name];
map[group.cover].set(0, 1);
map[\`\${prefix}Cover\`];
function generic<Key extends PhysicalBufferName>(key: Key) { return map[key]; }
map.mesh;
map["mesh"];
unrelated.Elevation;
unrelated["Elevation"];
`;
const host = ts.createCompilerHost(configuration.options),
  originalSource = host.getSourceFile;
host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
  file === contractPath
    ? ts.createSourceFile(file, contract, languageVersion, true)
    : originalSource(file, languageVersion, onError, shouldCreateNewSourceFile);
const program = ts.createProgram(
    [...roots, contractPath],
    { ...configuration.options, noEmit: true },
    host
  ),
  checker = program.getTypeChecker(),
  files = program.getSourceFiles().filter((file) => roots.includes(file.fileName));
function walk(node: ts.Node, inspect: (node: ts.Node) => void) {
  inspect(node);
  ts.forEachChild(node, (child) => walk(child, inspect));
}
function symbol(node: ts.Node) {
  const found = checker.getSymbolAtLocation(node);
  return found && found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
}
const at = (node: ts.Node) => {
  const file = node.getSourceFile();
  return `${relative(root, file.fileName)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
};
function domainFunction(node: ts.Node) {
  const found = symbol(node);
  return found?.declarations?.some((item) => item.getSourceFile().fileName.startsWith(domain))
    ? found.name
    : undefined;
}
const fieldOperations = new Set([
  "putChannel",
  "requireChannel",
  "channelUnit",
  "sample",
  "gridSampler",
  "fieldInterpolator",
  "classInterpolator",
  "resample",
  "resampleChannels",
  "fieldCategories",
  "fieldExtrema",
]);
function gridType(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some(gridType);
  return ["channels", "units", "active", "coverage"].every((name) => type.getProperty(name));
}
function channelMember(node: ts.Node) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  const source = node.expression;
  return channelRecord(source);
}
function channelRecord(node: ts.Node) {
  return (
    ts.isPropertyAccessExpression(node) &&
    ["channels", "units", "quantities"].includes(node.name.text) &&
    gridType(checker.getTypeAtLocation(node.expression))
  );
}
const physicalNames = new Set<string>(canonicalPhysicalFields().map(({ name }) => name));
function physicalKey(type: ts.Type): boolean {
  const constrained = checker.getBaseConstraintOfType(type);
  if (constrained && constrained !== type) return physicalKey(constrained);
  if (type.isUnion()) return type.types.some(physicalKey);
  return type.isStringLiteral() && physicalNames.has(type.value);
}
function physicalMember(node: ts.Node) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  const owner = checker.getTypeAtLocation(node.expression);
  if (!owner.getProperty("mesh") || !owner.getProperty("scale")) return false;
  return ts.isPropertyAccessExpression(node)
    ? physicalNames.has(node.name.text)
    : physicalKey(checker.getTypeAtLocation(node.argumentExpression));
}

it("recognizes literal, union, template and generic indexed physical fields", () => {
  const file = program.getSourceFile(contractPath)!,
    accesses: string[] = [];
  expect(program.getSemanticDiagnostics(file)).toEqual([]);
  walk(file, (node) => {
    if (physicalMember(node)) accesses.push(node.getText());
  });
  expect(accesses).toEqual([
    "map.Elevation",
    'map["Elevation"]',
    "map[name]",
    "map[group.cover]",
    "map[`${prefix}Cover`]",
    "map[key]",
  ]);
});

it("inventories compiler-resolved field producers and readers", () => {
  const inventory: { at: string; kind: string; expression: string }[] = [];
  for (const file of files)
    walk(file, (node) => {
      const operation = ts.isCallExpression(node) ? domainFunction(node.expression) : undefined;
      if (operation && fieldOperations.has(operation))
        inventory.push({ at: at(node), kind: operation, expression: node.getText() });
      else if (channelMember(node))
        inventory.push({ at: at(node), kind: "channel-member", expression: node.getText() });
      else if (physicalMember(node))
        inventory.push({ at: at(node), kind: "physical-member", expression: node.getText() });
    });
  expect(inventory.length).toBeGreaterThan(0);
  inventory.sort((a, b) => a.at.localeCompare(b.at) || a.expression.localeCompare(b.expression));
  const output = join(root, ".artifacts");
  mkdirSync(output, { recursive: true });
  writeFileSync(
    join(output, "canonical-field-call-sites.json"),
    JSON.stringify(inventory, null, 2)
  );
}, 30_000);

it("literal physical producers declare the canonical working unit", () => {
  const units = new Map<string, string>([
      ...physicalChannels.map(({ name, unit }): [string, string] => [name, unit]),
      ...derived.map(([name, unit]): [string, string] => [name, unit]),
    ]),
    findings: string[] = [];
  for (const file of files)
    walk(file, (node) => {
      if (!ts.isCallExpression(node) || domainFunction(node.expression) !== "putChannel") return;
      const [, name, unit] = node.arguments;
      if (!name || !unit || !ts.isStringLiteral(name) || !ts.isStringLiteral(unit)) return;
      const expected = units.get(name.text);
      if (expected && unit.text !== expected)
        findings.push(`${at(node)} ${name.text}: ${unit.text}; expected ${expected}`);
    });
  expect(findings.sort()).toEqual([]);
});

function broadType(node: ts.TypeNode) {
  return [
    ts.SyntaxKind.StringKeyword,
    ts.SyntaxKind.AnyKeyword,
    ts.SyntaxKind.UnknownKeyword,
  ].includes(node.kind);
}
function widenedGrid(node: ts.TypeReferenceNode) {
  const name = symbol(node.typeName);
  return (
    ["Grid", "GridSurface", "FieldSamples"].includes(name?.name ?? "") &&
    name?.declarations?.some(
      (item) => item.getSourceFile().fileName === join(domain, "grids.ts")
    ) &&
    node.typeArguments?.some(broadType)
  );
}
function widening(node: ts.Node): string | undefined {
  if (ts.isTypeReferenceNode(node) && widenedGrid(node)) return `widens ${node.getText()}`;
  if (
    ts.isCallExpression(node) &&
    fieldOperations.has(domainFunction(node.expression) ?? "") &&
    node.typeArguments?.some(broadType)
  )
    return `widens ${node.expression.getText()}`;
  return undefined;
}
function castField(node: ts.Node) {
  if (!ts.isAsExpression(node) && !ts.isTypeAssertionExpression(node)) return false;
  return (
    gridType(checker.getTypeAtLocation(node.expression)) ||
    channelMember(node.expression) ||
    channelRecord(node.expression)
  );
}
it("active generation cannot widen a physical grid or its field operations to arbitrary channels", () => {
  const findings: string[] = [];
  for (const file of files.filter((item) => item.fileName.startsWith(generation)))
    walk(file, (node) => {
      const widened = widening(node);
      if (widened) findings.push(`${at(node)} ${widened}`);
      if (castField(node)) findings.push(`${at(node)} casts a grid or its numerical channel`);
    });
  expect(findings.sort()).toEqual([]);
});
