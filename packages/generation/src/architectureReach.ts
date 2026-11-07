import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";
import { physicalSchema } from "./world/field";

/**
 * Reading the program for the architecture checks: what code a body reaches, and the bands and context
 * it touches on the way. Used only by `*.architecture.ts`.
 */
export const source = __dirname;
export interface Reach {
  reads: Set<string>;
  writes: Set<string>;
  /** What it asks of the context that tells it which epoch it is in. */
  epoch: Set<string>;
}
export function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|architecture)\.tsx?$/.test(entry.name))
      yield path;
  }
}
const writing = new Set(["set", "fill", "copyFrom", "add", "block"]),
  reading = new Set(["get", "add", "toArray", "length", "block"]),
  epochTells = new Set(["IsEvolutionEpoch", "EpochIndex", "EpochCount"]);
export function program() {
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
export class Follower {
  private readonly checker: ts.TypeChecker;
  private readonly bands = new Set(physicalSchema().map(({ name }) => name as string));
  constructor(program: ts.Program) {
    this.checker = program.getTypeChecker();
  }
  private hasProperties(node: ts.Expression, ...names: string[]) {
    const type = this.checker.getApparentType(this.checker.getTypeAtLocation(node));
    return names.every((name) => Boolean(type.getProperty(name)));
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
  private inspect(node: ts.PropertyAccessExpression, reach: Reach) {
    const name = node.name.text;
    if (this.bands.has(name) && this.hasProperties(node.expression, "mesh", "EffectiveSeaLevel"))
      this.note(node, name, reach);
    if (epochTells.has(name) && this.hasProperties(node.expression, "Span", "Profile"))
      reach.epoch.add(name);
  }
  /** Everything the code at `start` reaches, through every function it can name. */
  follow(start: ts.Node[]): Reach {
    const reach: Reach = { reads: new Set(), writes: new Set(), epoch: new Set() },
      seen = new Set<ts.Node>(),
      stack = [...start],
      visit = (node: ts.Node) => {
        if (ts.isTypeNode(node) || ts.isImportDeclaration(node)) return;
        if (ts.isPropertyAccessExpression(node)) this.inspect(node, reach);
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
export const sorted = (bands: Iterable<string>) => [...bands].sort();
/** Each `step("name", salt, ...processes)` of the sequence: its name and the processes it runs. */
export function stepCalls(file: ts.SourceFile) {
  const steps = new Map<string, ts.Expression[]>(),
    walk = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ["step", "stage"].includes(node.expression.getText()) &&
        ts.isStringLiteral(node.arguments[0])
      )
        steps.set(node.arguments[0].text, [...node.arguments.slice(2)]);
      ts.forEachChild(node, walk);
    };
  walk(file);
  return steps;
}
