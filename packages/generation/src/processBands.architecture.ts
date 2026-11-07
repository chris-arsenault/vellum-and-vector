import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { pools } from "./coupling/flows";
import { groundProcesses } from "./processes/processCatalogue";
import { physicalSchema } from "./world/field";
import { physicalSteps } from "./world/physicalSteps";

/**
 * What the code reaches, held against what it says. From each world step and each process that holds
 * the whole field, this follows the program from its body through every function it can name, and
 * lists the field's bands it reads and writes. A claim the code does not back fails here, and so does a
 * process in the catalogue the sequence never runs. Run with `make test-architecture`; `make
 * process-bands` writes the builders' lists afresh.
 */
const source = __dirname,
  generated = join(source, "processes/builderBands.generated.json");
interface Reach {
  reads: Set<string>;
  writes: Set<string>;
}
/** What moves material without being a process on the ground: magic and placed landmarks. */
const nonProcessMovers = [
  "aurora",
  "confluences",
  "fire",
  "greenwood",
  "landmarks",
  "magic rock",
  "pressure",
  "salt",
  "veil",
];
/**
 * The only files that write the land's height and rock outside the ledger, each for a stated reason:
 * regional refinement until its own turn comes, and code that rebuilds a surface from its parts or
 * moves what the crust carries as a whole.
 */
const landWriters = new Set([
  "rock/groundLedger.ts",
  "rock/rockHistory.ts", // Loose cover turning to rock where it lies, through the ledger's rock.
  "world/support.ts", // The crust settling moves everything on it.
  "world/reliefCarry.ts", // Plates moving what stands on them.
  "world/orogenicSheets.ts", // Thrust sheets moving what stands on them.
  "world/atlasWorkspace.ts", // A surface authored or inherited, set up from its parts.
  "world/adaptiveRelief.ts", // A region realizing the relief its parent left latent.
  "societyEnvironment.ts", // A saved surface read back into the field.
  "poi/poiEffects.ts", // A place's own effect on the surface, kept in the rock beneath it.
  "regional/causes/landmark.ts",
  "regional/erosion.ts",
  "regional/glacial.ts",
  "regional/grading.ts",
  "regional/lakeShores.ts",
  "regional/relief.ts",
  "regional/sediment.ts",
]);
const landBands = "BedrockElevation|SurfaceRockLoad|SedimentThickness",
  landWrite = new RegExp(`\\.(?:${landBands})\\.(?:set|add|fill)\\(`);
function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.ts$/.test(entry.name) && !/\.(test|architecture)\.ts$/.test(entry.name)) yield path;
  }
}
const writing = new Set(["set", "fill", "copyFrom", "add", "block"]),
  reading = new Set(["get", "add", "toArray", "length", "block"]);
function program() {
  const path = join(source, "../tsconfig.json"),
    config = ts.parseJsonConfigFileContent(
      ts.readConfigFile(path, ts.sys.readFile).config,
      ts.sys,
      dirname(path)
    ),
    roots = ["world/sequence.ts", "processes/builders.ts", "processes/processCatalogue.ts"];
  return ts.createProgram(
    roots.map((file) => join(source, file)),
    { ...config.options, noEmit: true, skipLibCheck: true }
  );
}
class Follower {
  private readonly checker: ts.TypeChecker;
  private readonly bands = new Set(physicalSchema().map(({ name }) => name as string));
  constructor(program: ts.Program) {
    this.checker = program.getTypeChecker();
  }
  private isField(node: ts.Expression) {
    const type = this.checker.getApparentType(this.checker.getTypeAtLocation(node));
    return Boolean(type.getProperty("mesh") && type.getProperty("EffectiveSeaLevel"));
  }
  private target(node: ts.Identifier) {
    let symbol = this.checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = this.checker.getAliasedSymbol(symbol);
    return (symbol?.declarations ?? []).filter((declaration) => {
      const file = declaration.getSourceFile().fileName;
      return (
        file.startsWith(source) &&
        !file.endsWith(".test.ts") &&
        !ts.isImportSpecifier(declaration) &&
        !ts.isParameter(declaration) &&
        !ts.isInterfaceDeclaration(declaration) &&
        !ts.isTypeAliasDeclaration(declaration)
      );
    });
  }
  private note(access: ts.PropertyAccessExpression, name: string, reach: Reach) {
    const parent = access.parent;
    if (!ts.isPropertyAccessExpression(parent) || parent.expression !== access) {
      reach.reads.add(name);
      reach.writes.add(name);
      return;
    }
    if (reading.has(parent.name.text)) reach.reads.add(name);
    if (writing.has(parent.name.text)) reach.writes.add(name);
  }
  /** Every band the code at `start` reads or writes, through every function it can name. */
  follow(start: ts.Node[]): Reach {
    const reach: Reach = { reads: new Set(), writes: new Set() },
      seen = new Set<ts.Node>(),
      stack = [...start],
      visit = (node: ts.Node) => {
        if (ts.isTypeNode(node) || ts.isImportDeclaration(node)) return;
        if (
          ts.isPropertyAccessExpression(node) &&
          this.bands.has(node.name.text) &&
          this.isField(node.expression)
        )
          this.note(node, node.name.text, reach);
        if (ts.isIdentifier(node)) stack.push(...this.target(node));
        ts.forEachChild(node, visit);
      };
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      visit(node);
    }
    return reach;
  }
}
const sorted = (bands: Iterable<string>) => [...bands].sort();
/** Each `["name", salt, body]` of the sequence, by name, with every body it is given. */
function stepBodies(file: ts.SourceFile) {
  const bodies = new Map<string, ts.Node[]>(),
    walk = (node: ts.Node) => {
      if (
        ts.isArrayLiteralExpression(node) &&
        node.elements.length === 3 &&
        ts.isStringLiteral(node.elements[0])
      ) {
        const name = node.elements[0].text;
        bodies.set(name, [...(bodies.get(name) ?? []), node.elements[2]]);
      }
      ts.forEachChild(node, walk);
    };
  walk(file);
  return bodies;
}
/** The identifiers handed to `actBy` anywhere in the sequence. */
function processesRun(file: ts.SourceFile) {
  const run = new Set<string>(),
    walk = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "actBy"
      )
        for (const argument of node.arguments) run.add(argument.getText());
      ts.forEachChild(node, walk);
    };
  walk(file);
  return run;
}
/** The entries of the catalogue's list, by the name it knows them by. */
function catalogued(file: ts.SourceFile) {
  const names = new Set<string>(),
    walk = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText() === "groundProcesses" &&
        node.initializer &&
        ts.isArrayLiteralExpression(node.initializer)
      )
        for (const entry of node.initializer.elements) names.add(entry.getText());
      ts.forEachChild(node, walk);
    };
  walk(file);
  return names;
}
/** Each process built on the whole field: `builder(id, statement, moves, body)`. */
function builderBodies(file: ts.SourceFile) {
  const bodies = new Map<string, ts.Node>(),
    walk = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText() === "builder" &&
        ts.isStringLiteral(node.arguments[0])
      )
        bodies.set(node.arguments[0].text, node.arguments[3]);
      ts.forEachChild(node, walk);
    };
  walk(file);
  return bodies;
}
/** Everyone named as moving material through the ledger, as the code names them. */
function causesNamed(built: ts.Program) {
  const ledger = new Set([
      "raiseRock",
      "raiseFromCrust",
      "deposit",
      "erode",
      "recordCut",
      "shed",
      "carryOut",
      "displaceGround",
    ]),
    named = new Set<string>(),
    walk = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ledger.has(node.expression.getText()))
        for (const argument of node.arguments)
          if (ts.isStringLiteralLike(argument)) named.add(argument.text);
      ts.forEachChild(node, walk);
    };
  for (const file of built.getSourceFiles())
    if (file.fileName.startsWith(source) && !file.fileName.endsWith(".test.ts")) walk(file);
  return named;
}
function builderLists(follower: Follower, builders: ts.SourceFile) {
  const lists: Record<string, { reads: string[]; writes: string[] }> = {};
  for (const [id, body] of builderBodies(builders)) {
    const reach = follower.follow([body]);
    lists[id] = { reads: sorted(reach.reads), writes: sorted(reach.writes) };
  }
  return lists;
}
describe("what the code reaches", () => {
  const built = program(),
    follower = new Follower(built),
    file = (path: string) => built.getSourceFile(join(source, path))!,
    sequence = file("world/sequence.ts"),
    bodies = stepBodies(sequence);
  it("declares every step of the sequence, and no other", () => {
    expect(sorted(Object.keys(physicalSteps))).toEqual(sorted(bodies.keys()));
  });
  it("needs and writes only what each step's code really reads and writes", () => {
    const stale: string[] = [];
    for (const [name, nodes] of bodies) {
      const reach = follower.follow(nodes),
        declared = physicalSteps[name];
      for (const band of declared.needs)
        if (!reach.reads.has(band)) stale.push(`${name} needs ${band} but never reads it`);
      for (const band of declared.writes)
        if (!reach.writes.has(band)) stale.push(`${name} writes ${band} but never does`);
    }
    expect(stale).toEqual([]);
  });
  it("runs every process in the catalogue, and catalogues every process it runs", () => {
    expect(sorted(processesRun(sequence))).toEqual(
      sorted(catalogued(file("processes/processCatalogue.ts")))
    );
  });
  it("names only catalogued processes as movers, and pools as where material goes", () => {
    const known = new Set<string>([
      ...groundProcesses.map(({ id }) => id),
      ...pools,
      ...nonProcessMovers,
    ]);
    expect(sorted(causesNamed(built)).filter((name) => !known.has(name))).toEqual([]);
  });
  it("changes the land's height and rock through the ledger, outside the stated exceptions", () => {
    const stray = [...sourceFiles(source)]
      .filter((path) => landWrite.test(readFileSync(path, "utf8")))
      .map((path) => relative(source, path))
      .filter((path) => !landWriters.has(path));
    expect(stray).toEqual([]);
  });
  it("lists what each process on the whole field reaches, as the code stands", () => {
    const lists = builderLists(follower, file("processes/builders.ts"));
    if (process.env.ATLAS_WRITE_BANDS)
      writeFileSync(generated, `${JSON.stringify(lists, null, 2)}\n`);
    expect(JSON.parse(readFileSync(generated, "utf8"))).toEqual(lists);
  });
});
