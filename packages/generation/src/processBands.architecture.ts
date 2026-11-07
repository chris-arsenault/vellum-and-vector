import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { Follower, program, sorted, source, stepCalls } from "./architectureReach";
import { pools } from "./coupling/flows";
import { groundProcesses } from "./processes/processCatalogue";
import { physicalSteps } from "./world/physicalSteps";

/**
 * What the code reaches, held against what it says. From each world step and each process that holds
 * the whole field, this follows the program from its body through every function it can name, and
 * lists the field's bands it reads and writes. A claim the code does not back fails here, and so does a
 * process in the catalogue the sequence never runs. Run with `make test-architecture`; `make
 * process-bands` writes the builders' lists afresh.
 */
const generated = join(source, "processes/builderBands.generated.json");
/**
 * What moves material without being a process on the ground: magic, storms, placed landmarks, and a
 * region refining what its parent left.
 */
const nonProcessMovers = [
  "aurora",
  "confluences",
  "fire",
  "greenwood",
  "landmarks",
  "magic rock",
  "pressure",
  "regional",
  "salt",
  "storms",
  "veil",
];
/** The code every view-holding process reaches through what it is handed. */
function handedOver(file: ts.SourceFile) {
  const found: ts.Node[] = [];
  ts.forEachChild(file, (node) => {
    if (ts.isFunctionDeclaration(node) && ["workFor", "inSubsteps"].includes(node.name?.text ?? ""))
      found.push(node);
  });
  return found;
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
/** Each process built on the whole field: the `id` and `build` of its `builder({...})`. */
function builderBodies(file: ts.SourceFile, bodies = new Map<string, ts.Node>()) {
  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText() === "builder") {
      const entry = node.arguments[0] as ts.ObjectLiteralExpression,
        field = (name: string) =>
          entry.properties.find((each) => each.name?.getText() === name) as
            ts.PropertyAssignment | ts.MethodDeclaration | undefined,
        id = field("id") as ts.PropertyAssignment;
      bodies.set((id.initializer as ts.StringLiteral).text, field("build")!);
    }
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
      "standGround",
      "shiftRock",
      "lithify",
      "looseTo",
      "spoilSoil",
      "meltIce",
      "weatherRock",
      "wearAway",
      "demand",
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
function builderLists(follower: Follower, files: ts.SourceFile[]) {
  const lists: Record<string, { reads: string[]; writes: string[] }> = {},
    bodies = new Map<string, ts.Node>();
  for (const file of files) builderBodies(file, bodies);
  for (const [id, body] of bodies) {
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
    steps = stepCalls(sequence),
    shared = handedOver(file("processes/processCatalogue.ts"));
  it("declares every step of the sequence, and no other", () => {
    expect(sorted(Object.keys(physicalSteps))).toEqual(sorted(steps.keys()));
  });
  it("needs and writes only what each step's code really reads and writes", () => {
    const stale: string[] = [];
    for (const [name, processes] of steps) {
      const reach = follower.follow([...processes, ...shared]),
        declared = physicalSteps[name];
      for (const band of declared.needs)
        if (!reach.reads.has(band)) stale.push(`${name} needs ${band} but never reads it`);
      for (const band of declared.writes)
        if (!reach.writes.has(band)) stale.push(`${name} writes ${band} but never does`);
    }
    expect(stale).toEqual([]);
  });
  it("runs every process in the catalogue, and catalogues every process it runs", () => {
    const run = new Set([...steps.values()].flat().map((each) => each.getText()));
    expect(sorted(run)).toEqual(sorted(catalogued(file("processes/processCatalogue.ts"))));
  });
  it("names only catalogued processes as movers, and pools as where material goes", () => {
    const known = new Set<string>([
      ...groundProcesses.map(({ id }) => id),
      ...pools,
      ...nonProcessMovers,
    ]);
    expect(sorted(causesNamed(built)).filter((name) => !known.has(name))).toEqual([]);
  });
  it("lists what each process on the whole field reaches, as the code stands", () => {
    const lists = builderLists(follower, [
      file("processes/builders.ts"),
      file("processes/crustProcesses.ts"),
      file("processes/climateProcesses.ts"),
      file("processes/waterProcesses.ts"),
    ]);
    if (process.env.ATLAS_WRITE_BANDS)
      writeFileSync(generated, `${JSON.stringify(lists, null, 2)}\n`);
    expect(JSON.parse(readFileSync(generated, "utf8"))).toEqual(lists);
  });
});
