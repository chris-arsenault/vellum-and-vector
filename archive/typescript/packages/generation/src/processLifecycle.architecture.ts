import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { source } from "./architectureReach";
import { contract, callerContract } from "./processLifecycleContracts";

/** The compiler supplies the inventory: new registrations cannot bypass a hand-maintained list. */
const root = join(source, "../../..");
const roots = ts.sys
  .readDirectory(
    root,
    [".ts", ".tsx"],
    ["**/node_modules/**", "**/dist/**", "**/.*/**", "**/*.architecture.ts"],
    ["packages/**/*", "frontend/**/*", "scripts/**/*", "*.ts"]
  )
  .sort();
const configPath = join(root, "frontend/tsconfig.json");
const configuration = ts.parseJsonConfigFileContent(
  ts.readConfigFile(configPath, ts.sys.readFile).config,
  ts.sys,
  dirname(configPath)
);
const contractPath = join(source, "__lifecycle_contract.ts");
const callerPath = join(root, "frontend/src/__lifecycle_caller.harness.ts");
const host = ts.createCompilerHost(configuration.options),
  originalSource = host.getSourceFile;
host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
  const text = file === contractPath ? contract : file === callerPath ? callerContract : undefined;
  return text === undefined
    ? originalSource(file, languageVersion, onError, shouldCreateNewSourceFile)
    : ts.createSourceFile(file, text, languageVersion, true);
};
const built = ts.createProgram(
  [...roots, contractPath, callerPath],
  { ...configuration.options, noEmit: true },
  host
);
const checker = built.getTypeChecker();
const files = built.getSourceFiles().filter((file) => roots.includes(file.fileName));
// Test registrations are supplied doubles, not ownership declarations for production helpers.
// Tests remain callers below: direct calls into real process implementations still fail.
const definitions = files.filter((file) => !/\.(test|spec)\.tsx?$/.test(file.fileName));
const runtime = join(source, "processOperation.ts");
const visit = (node: ts.Node, inspect: (node: ts.Node) => void) => {
  inspect(node);
  ts.forEachChild(node, (child) => visit(child, inspect));
};
function target(node: ts.Node) {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}
function executable(type: ts.Type): boolean {
  // Narrowed intersections can contain an impossible `never` arm; the shared opaque member is
  // the compiler's actual callable boundary for both unions and concrete operation references.
  return type.getProperties().some((property) => property.name.startsWith("__@implementation"));
}
function propertyType(type: ts.Type, name: string) {
  const property = type.getProperty(name),
    declaration = property?.declarations?.[0];
  return property && declaration
    ? checker.getTypeOfSymbolAtLocation(property, declaration)
    : undefined;
}
function processType(type: ts.Type): boolean {
  if (executable(type)) return true;
  const operation = propertyType(type, "operation");
  if (operation && executable(operation)) return true;
  return Boolean(
    propertyType(type, "prepare")
      ?.getCallSignatures()
      .some((signature) => executable(signature.getReturnType()))
  );
}
const position = (node: ts.Node) => {
  const file = node.getSourceFile();
  return `${relative(root, file.fileName)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
};
function ownsCallback(
  node: ts.Node,
  registrations: ReadonlySet<ts.CallExpression>,
  bodies: ReadonlyMap<ts.Node, Set<ts.CallExpression>>
) {
  let parent = node.parent;
  while (parent) {
    const owners = bodies.get(parent);
    if (owners) return [...owners].some((owner) => registrations.has(owner));
    if (ts.isCallExpression(parent)) {
      if (registrations.has(parent)) return true;
      const symbol = target(parent.expression);
      if (
        symbol?.name === "bindOperation" &&
        symbol.declarations?.some((declaration) => declaration.getSourceFile().fileName === runtime)
      )
        return true;
    }
    parent = parent.parent;
  }
  return false;
}
function directBody(node: ts.Node) {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node))
    return node.body;
  if (ts.isFunctionDeclaration(node)) return node.body;
}
function callbackTarget(node: ts.Node) {
  if (ts.isShorthandPropertyAssignment(node))
    return checker.getShorthandAssignmentValueSymbol(node);
  if (ts.isPropertyAssignment(node)) return callbackTarget(node.initializer);
  return ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) ? target(node) : undefined;
}
/** Resolve the registered callback itself, without following its callees into a speculative graph. */
function callbackBody(node: ts.Node, seen = new Set<ts.Node>()): ts.Node | undefined {
  if (seen.has(node)) return;
  seen.add(node);
  const body = directBody(node);
  if (body) return body;
  if (ts.isPropertyAssignment(node) || ts.isVariableDeclaration(node))
    return node.initializer && callbackBody(node.initializer, seen);
  if (ts.isParenthesizedExpression(node)) return callbackBody(node.expression, seen);
  const symbol = callbackTarget(node);
  return declarationBody(symbol, seen);
}
function declarationBody(symbol: ts.Symbol | undefined, seen: Set<ts.Node>) {
  for (const declaration of symbol?.declarations ?? []) {
    const body = callbackBody(declaration, seen);
    if (body) return body;
  }
}
function implementationCall(node: ts.Node) {
  if (!ts.isCallExpression(node)) return;
  if (node.arguments.some((argument) => executable(checker.getTypeAtLocation(argument)))) return;
  const symbol = target(node.expression);
  // The expected callback role establishes execution; TypeScript permits discarded return values.
  // Object methods remain the shared Ground/material API unless bound directly as a callback.
  return symbol?.declarations?.some(
    (declaration) =>
      declaration.getSourceFile().fileName.startsWith(`${source}/`) &&
      (ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration))
  )
    ? symbol
    : undefined;
}
function forwardedCall(body: ts.Node): ts.Node | undefined {
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1) return;
    const statement = body.statements[0];
    if (ts.isExpressionStatement(statement) || ts.isReturnStatement(statement))
      return statement.expression && forwardedCall(statement.expression);
    return;
  }
  if (ts.isAwaitExpression(body) || ts.isParenthesizedExpression(body))
    return forwardedCall(body.expression);
  return ts.isCallExpression(body) ? body : undefined;
}
function voidResult(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.every(voidResult);
  return Boolean((checker.getAwaitedType(type) ?? type).flags & ts.TypeFlags.Void);
}
function executableCallback(type: ts.Type) {
  return type.getCallSignatures().some((signature) => {
    const result = signature.getReturnType();
    return voidResult(result) || executable(result);
  });
}
function expectedCallback(parameter: ts.Symbol | undefined, argument: ts.Node) {
  return parameter && executableCallback(checker.getTypeOfSymbolAtLocation(parameter, argument));
}
function registrationCallbacks(node: ts.CallExpression) {
  const callbacks: ts.Node[] = [],
    parameters = checker.getResolvedSignature(node)?.parameters;
  for (const [index, argument] of node.arguments.entries()) {
    const parameter = parameters?.[index];
    if (expectedCallback(parameter, argument)) callbacks.push(argument);
    if (!ts.isObjectLiteralExpression(argument)) continue;
    for (const property of argument.properties)
      if (["execute", "prepare"].includes(property.name?.getText() ?? "")) callbacks.push(property);
  }
  return callbacks;
}
function queryType(type: ts.Type): boolean {
  const operation = propertyType(type, "operation");
  if (operation) return queryType(operation);
  const kind = propertyType(type, "kind");
  return executable(type) && kind?.isStringLiteral() === true && kind.value === "query";
}
function asyncQueryCallbacks(inputFiles = files) {
  const failures: string[] = [];
  for (const file of inputFiles)
    visit(file, (node) => {
      if (!ts.isCallExpression(node)) return;
      if (
        !queryType(checker.getTypeAtLocation(node)) &&
        !node.arguments.some((argument) => queryType(checker.getTypeAtLocation(argument)))
      )
        return;
      for (const callback of registrationCallbacks(node)) {
        const implementation = callbackBody(callback)?.parent;
        const type = checker.getTypeAtLocation(
          implementation ?? (ts.isPropertyAssignment(callback) ? callback.initializer : callback)
        );
        if (
          type.getCallSignatures().some((signature) => {
            const result = signature.getReturnType();
            return (checker.getAwaitedType(result) ?? result) !== result;
          })
        )
          failures.push(position(callback));
      }
    });
  return failures;
}
function boundAlgorithms(
  implementation: ts.Node,
  register: (symbol: ts.Symbol | undefined) => void,
  unresolved: string[]
) {
  const body = callbackBody(implementation),
    named = callbackTarget(implementation);
  if (!body) {
    // A factory forwards its callback parameter; the concrete caller supplies its body.
    if (
      !named?.declarations?.some(
        (declaration) => ts.isParameter(declaration) || ts.isBindingElement(declaration)
      )
    )
      unresolved.push(position(implementation));
    return;
  }
  register(named);
  if (ts.isFunctionDeclaration(body.parent) && body.parent.name) register(target(body.parent.name));
  else if (!named) {
    const call = forwardedCall(body);
    if (call) register(implementationCall(call));
  }
}
function operationKernels(inputFiles = definitions) {
  const kernels = new Map<ts.Symbol, Set<ts.CallExpression>>(),
    callbacks = new Map<ts.CallExpression, string[]>(),
    bodies = new Map<ts.Node, Set<ts.CallExpression>>(),
    unresolved: string[] = [];
  for (const file of inputFiles)
    visit(file, (node) => {
      if (!ts.isCallExpression(node)) return;
      if (!processType(checker.getTypeAtLocation(node))) return;
      const implementations = registrationCallbacks(node);
      if (!implementations.length) return;
      const bound: string[] = [];
      const register = (symbol: ts.Symbol | undefined) => {
        if (!symbol) return;
        const registrations = kernels.get(symbol) ?? new Set<ts.CallExpression>();
        registrations.add(node);
        kernels.set(symbol, registrations);
        bound.push(symbol.name);
      };
      for (const implementation of implementations) {
        const body = callbackBody(implementation);
        if (body) {
          const owners = bodies.get(body) ?? new Set<ts.CallExpression>();
          owners.add(node);
          bodies.set(body, owners);
        }
        boundAlgorithms(implementation, register, unresolved);
      }
      callbacks.set(node, [...new Set(bound)].sort());
    });
  return { kernels, callbacks, bodies, unresolved };
}

it("inventories every opaque registration and reference through compiler-resolved symbols", () => {
  const entries: { at: string; callee: string; source: string; kernels?: string[] }[] = [],
    { callbacks, unresolved } = operationKernels();
  expect(unresolved).toEqual([]);
  for (const file of files)
    visit(file, (node) => {
      if (!ts.isCallExpression(node)) return;
      if (
        processType(checker.getTypeAtLocation(node)) ||
        node.arguments.some((argument) => executable(checker.getTypeAtLocation(argument))) ||
        executable(checker.getTypeAtLocation(node.expression))
      )
        entries.push({
          at: position(node),
          callee: node.expression.getText(),
          source: node.getText(),
          ...(callbacks.has(node) ? { kernels: callbacks.get(node) } : {}),
        });
    });
  expect(entries.length).toBeGreaterThan(0);
  entries.sort((a, b) => a.at.localeCompare(b.at));
  const directory = join(source, "../../../.artifacts");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "process-call-sites.json"), JSON.stringify(entries, null, 2));
}, 30_000);

function bypassesIn(inputFiles = files, owners = definitions) {
  const { kernels, callbacks, bodies } = operationKernels(owners),
    allRegistrations = new Set(callbacks.keys()),
    bypasses: string[] = [];
  for (const file of inputFiles)
    visit(file, (node) => {
      if (!ts.isCallExpression(node)) return;
      const symbol = target(node.expression);
      if (!symbol) return;
      const registrations = kernels.get(symbol);
      if (!registrations || ownsCallback(node, registrations, bodies)) return;
      if (
        !ownsCallback(node, allRegistrations, bodies) &&
        symbol.declarations?.some((declaration) => declaration.getSourceFile() === file)
      )
        return;
      bypasses.push(`${position(node)} calls ${symbol.name}`);
    });
  return bypasses.sort();
}
it("registered kernels have no external calls outside their own registration or selected strategies", () => {
  expect(bypassesIn()).toEqual([]);
});

it("rejects an aliased kernel call from a frontend harness caller", () => {
  const file = built.getSourceFile(callerPath)!;
  expect(built.getSemanticDiagnostics(file)).toEqual([]);
  expect(bypassesIn([...files, file])).toContain(
    "frontend/src/__lifecycle_caller.harness.ts:4 calls plateAdvection"
  );
});

it("rejects raw entry callbacks and calls across distinct same-module operation owners", () => {
  const file = built.getSourceFile(contractPath)!,
    { kernels, unresolved } = operationKernels([file]);
  expect(unresolved).toEqual([]);
  expect([...kernels.keys()].map((symbol) => symbol.name).sort()).toEqual([
    "asyncKernel",
    "hiddenAsync",
    "kernel",
    "namedComposite",
    "nativeKernel",
    "returningNumber",
  ]);
  expect(bypassesIn([file], [file]).map((message) => message.split(" calls ")[1])).toEqual([
    "kernel",
    "asyncKernel",
    "kernel",
    "returningNumber",
  ]);
  expect(built.getSemanticDiagnostics(file).map((diagnostic) => diagnostic.code)).toEqual([
    2322, 2322, 2322,
  ]);
  expect(asyncQueryCallbacks([file])).toHaveLength(5);
});

it("current query implementations and selected strategies complete synchronously", () => {
  expect(asyncQueryCallbacks()).toEqual([]);
});

it("opaque references cannot be called, cast into callbacks, or expose the old optional dispatch shape", () => {
  const bypasses: string[] = [];
  for (const file of files)
    visit(file, (node) => {
      if (file.fileName === runtime) return;
      if (ts.isCallExpression(node) && executable(checker.getTypeAtLocation(node.expression)))
        bypasses.push(`${position(node)} invokes an opaque reference directly`);
      if (
        (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
        executable(checker.getTypeAtLocation(node.expression))
      )
        bypasses.push(`${position(node)} casts an executable reference`);
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText() === "behavior" &&
        node.parent.properties.some((property) => property.name?.getText() === "contract")
      )
        bypasses.push(`${position(node)} declares retired callback dispatch`);
    });
  expect(bypasses.sort()).toEqual([]);
});
