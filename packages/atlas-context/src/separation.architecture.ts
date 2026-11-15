import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../../..");
function staticImport(node: ts.Node) {
  if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node))) return null;
  return node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    ? node.moduleSpecifier.text
    : null;
}
function typeImport(node: ts.Node) {
  if (!ts.isImportTypeNode(node) || !ts.isLiteralTypeNode(node.argument)) return null;
  return ts.isStringLiteral(node.argument.literal) ? node.argument.literal.text : null;
}
function dynamicImport(node: ts.Node) {
  if (!ts.isCallExpression(node)) return null;
  const load =
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === "require");
  if (!load) return null;
  const argument = node.arguments[0];
  return argument && ts.isStringLiteral(argument) ? argument.text : "<dynamic import>";
}
function imports(text: string, runtime = false) {
  const file = ts.createSourceFile("contract.ts", text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (
      runtime &&
      (ts.isImportTypeNode(node) ||
        ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && onlyTypes(node)))
    )
      return;
    const source = staticImport(node) ?? typeImport(node) ?? dynamicImport(node);
    if (source) found.push(source);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.tsx?$/.test(path) && !/\.(test|architecture)\.tsx?$/.test(path)
        ? [path]
        : [];
  });
}
function allowed(source: string, file: string, directory: string, name: string) {
  if (source.startsWith(".")) return resolve(dirname(file), source).startsWith(directory + sep);
  return name === "atlas-context" && source === "@atlas/map";
}

function onlyTypes(node: ts.Statement) {
  if (ts.isExportDeclaration(node)) return node.isTypeOnly;
  if (!ts.isImportDeclaration(node)) return false;
  const clause = node.importClause;
  if (clause?.isTypeOnly) return true;
  if (!clause || clause.name) return false;
  const names = clause.namedBindings;
  return names && ts.isNamedImports(names) && names.elements.every((item) => item.isTypeOnly);
}
function runtimeImports(text: string) {
  return imports(text, true);
}
const presentationPackages = new Set([
  "@atlas/map",
  "cbor-x",
  "zod",
  "geostyler-openlayers-parser",
  "geotiff",
  "react",
  "uuid",
  "@tanstack/react-query",
  "antd",
]);
function consumerDependencies(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  return runtimeImports(readFileSync(file, "utf8")).flatMap((source) => {
    if (source.endsWith(".css")) return [];
    if (source.startsWith(".")) {
      const target = [".ts", ".tsx"]
        .map((extension) => resolve(dirname(file), `${source}${extension}`))
        .find((target) => existsSync(target));
      if (!target) return [`${file}: unresolved ${source}`];
      return consumerDependencies(target, seen);
    }
    return presentationPackages.has(source) ||
      source.startsWith("geostyler/dist/") ||
      source.startsWith("ol/")
      ? []
      : [`${file}: ${source}`];
  });
}

function expectRustMapBoundary() {
  for (const directory of ["map_store", "postgres_maps", "map_protocol"]) {
    const store = join(root, "crates/atlas-gis/src", directory);
    for (const file of readdirSync(store, { recursive: true })) {
      if (typeof file !== "string" || !file.endsWith(".rs")) continue;
      expect(readFileSync(join(store, file), "utf8"), file).not.toMatch(
        /atlas_generation|crate::(?:generation|numerical|private_inputs)/
      );
    }
  }
}
const mapConsumers = [
  "frontend/src/FinishedMapEditor.tsx",
  "frontend/src/publishedRaster.ts",
  "frontend/src/publishedMapEngine.ts",
  "frontend/src/publishedScene.ts",
  "frontend/src/publishedDrawing.ts",
  "frontend/src/publishedIllustrationData.ts",
  "frontend/src/PublishedMapView.ts",
  "frontend/src/PublishedMapCanvas.tsx",
  "frontend/src/PublishedLayerPanel.tsx",
  "frontend/src/PublishedAppearance.tsx",
  "frontend/src/PublishedSheetPanel.tsx",
  "frontend/src/PublishedCellInspection.tsx",
  "frontend/src/PublishedFeatureInformation.tsx",
  "frontend/src/PublishedRegistry.tsx",
  "frontend/src/PublishedRegionsPanel.tsx",
  "frontend/src/PublishedMapViews.tsx",
  "frontend/src/usePublishedRegions.ts",
  "frontend/src/usePublishedNavigation.ts",
  "frontend/src/publishedInteractions.ts",
  "packages/transport/src/mapReader.ts",
];
it("both application generation hosts use the Rust producer", () => {
  const browser = readFileSync(join(root, "crates/atlas-host/src/browser_job.rs"), "utf8");
  const native = readFileSync(join(root, "crates/atlas-host/src/native_jobs/run.rs"), "utf8");
  const worker = readFileSync(join(root, "frontend/src/atlasContext.worker.ts"), "utf8");
  expect(browser).toContain("generation_execution::run(");
  expect(native).toContain("native_generation_job::{NativeJob, Services}");
  expect(native).toContain("request.run(");
  expect(worker).toContain("new BrowserJobs(engine, maps)");
  for (const path of [
    "packages/generation/package.json",
    "packages/application/package.json",
    "packages/name-forge/package.json",
    "packages/server/package.json",
    "packages/storage-postgres/package.json",
  ])
    expect(existsSync(join(root, path)), path).toBe(false);
  const hosts = [
    "crates/atlas-host/src/browser_job.rs",
    "crates/atlas-host/src/native_generation_job.rs",
  ]
    .map((path) => readFileSync(join(root, path), "utf8"))
    .join("\n");
  expect(hosts).not.toMatch(/rustNaming|BrowserNaming|callbacks\.name|call\("name"/);
});
describe("published map dependency boundary", () => {
  // owner-direction(2026-11-12): delete both old C# and TypeScript backends
  it("does not revive retired backend implementations or deployment paths", () => {
    for (const path of [
      "backend",
      "db/migrations",
      "infrastructure/backend-prototype",
      "scripts/build-backend.sh",
      "scripts/test-stack.sh",
      "scripts/deploy.sh",
    ])
      expect(existsSync(join(root, path)), path).toBe(false);
  });
  it("map readers and GPU presentation have no runtime route into generation or resource storage", () => {
    for (const file of mapConsumers) expect(consumerDependencies(join(root, file))).toEqual([]);
    expectRustMapBoundary();
  });
  it("map tables and foreign keys stay in the independent map schema", () => {
    const mapSchema = readFileSync(join(root, "crates/atlas-gis/src/map_store/schema.sql"), "utf8");
    const tables = [...mapSchema.matchAll(/CREATE (?:VIRTUAL )?TABLE IF NOT EXISTS (\w+)/g)].map(
      (match) => match[1]
    );
    const references = [...mapSchema.matchAll(/REFERENCES (\w+)/g)].map((match) => match[1]);
    expect(tables.length).toBeGreaterThan(0);
    expect(
      [...tables, ...references].every((name) => name === "maps" || name.startsWith("map_"))
    ).toBe(true);
  });
  it("PostGIS map tables reference only map records", () => {
    const sql = readFileSync(join(root, "crates/atlas-gis/src/postgres_maps/schema.sql"), "utf8");
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS ([\w.]+)/g)].map(
      (match) => match[1]
    );
    const references = [...sql.matchAll(/REFERENCES ([\w.]+)/g)].map((match) => match[1]);
    expect(tables.length).toBeGreaterThan(0);
    expect([...tables, ...references].every((name) => name.startsWith("map."))).toBe(true);
  });
  it.each(["map", "atlas-context"])(
    "keeps %s contracts independent of generation and storage",
    (name) => {
      const directory = join(root, "packages", name, "src");
      const files = sourceFiles(directory);
      expect(files.length).toBeGreaterThan(0);
      const forbidden = files.flatMap((file) =>
        imports(readFileSync(file, "utf8"))
          .filter((source) => !allowed(source, file, directory, name))
          .map((source) => `${file}: ${source}`)
      );
      expect(forbidden).toEqual([]);
    }
  );

  it("the Rust map crate has no generation or host dependency", () => {
    const manifest = readFileSync(join(root, "crates/atlas-map/Cargo.toml"), "utf8");
    expect(manifest).not.toMatch(/atlas-(generation|host)/);
  });
  it("GIS storage is independent of generation and renderer composition", () => {
    const manifest = readFileSync(join(root, "crates/atlas-gis/Cargo.toml"), "utf8");
    expect(manifest).not.toMatch(/atlas-(generation|host|names)/);
    expectRustMapBoundary();
    const protocol = readFileSync(join(root, "crates/atlas-gis/src/map_protocol/read.rs"), "utf8");
    expect(protocol).not.toMatch(/Drawing|Generation|Numerical|PrivateInputs/);
  });
  it("covers reexports, type imports, lazy loads and nested escapes", () => {
    const found = imports(
      'export * from "@atlas/generation"; type T = import("@atlas/domain").Grid; const load = () => import("@atlas/storage-browser");'
    );
    expect(found).toEqual(["@atlas/generation", "@atlas/domain", "@atlas/storage-browser"]);
    expect(
      runtimeImports(
        'const point = value as import("geojson").Point; const load = () => import("@atlas/generation");'
      )
    ).toEqual(["@atlas/generation"]);
    expect(allowed("../../generation", "/map/src/nested/view.ts", "/map/src", "map")).toBe(false);
    expect(allowed("../generated", "/map/src/nested/view.ts", "/map/src", "map")).toBe(true);
  });
});
