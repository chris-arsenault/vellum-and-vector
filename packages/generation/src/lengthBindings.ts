import ts from "typescript";
import { dirname, join } from "node:path";

export function unwrap(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  )
    return unwrap(expression.expression);
  return expression;
}

export interface LengthSource {
  file: ts.SourceFile;
  constants: Map<string, ts.Expression>;
  binding: ReturnType<typeof lexicalBindings>;
  definitions: Set<ts.Node>;
  scales: Set<string>;
  imports: { local: string; name: string; module: string }[];
  links: Map<string, { source: LengthSource; name: string }>;
}
function importedNames(node: ts.Node, imports: LengthSource["imports"]) {
  if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
  const bindings = node.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return;
  for (const binding of bindings.elements)
    imports.push({
      local: binding.name.text,
      name: binding.propertyName?.text ?? binding.name.text,
      module: node.moduleSpecifier.text,
    });
}
export function lengthSource(fileName: string, text: string): LengthSource {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true),
    constants = new Map<string, ts.Expression>(),
    scales = new Set<string>(),
    imports: LengthSource["imports"] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableStatement(node.parent.parent) &&
      ts.isSourceFile(node.parent.parent.parent)
    )
      constants.set(node.name.text, node.initializer);
    if (ts.isImportSpecifier(node) && (node.propertyName?.text ?? node.name.text) === "MapScale")
      scales.add(node.name.text);
    importedNames(node, imports);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return {
    file,
    constants,
    binding: lexicalBindings(file),
    definitions: new Set(),
    scales,
    imports,
    links: new Map(),
  };
}
export function linkLengthImports(inputs: LengthSource[]) {
  const files = new Map(inputs.map((input) => [input.file.fileName, input]));
  for (const input of inputs)
    for (const item of input.imports) {
      if (!item.module.startsWith(".")) continue;
      const stem = join(dirname(input.file.fileName), item.module).replace(/\.js$/, ""),
        target = files.get(`${stem}.ts`) ?? files.get(join(stem, "index.ts"));
      if (target) input.links.set(item.local, { source: target, name: item.name });
    }
}

interface Binding {
  value?: ts.Expression;
  type?: ts.TypeNode;
}
const scope = (node: ts.Node): boolean =>
  ts.isSourceFile(node) ||
  ts.isBlock(node) ||
  ts.isFunctionLike(node) ||
  ts.isForStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isForInStatement(node);

/** Resolve lexical declarations without treating a sibling function's local as a file constant. */
export function lexicalBindings(file: ts.SourceFile) {
  const scopes = new Map<ts.Node, Map<string, Binding>>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      if (ts.isIdentifier(node.name)) {
        let owner: ts.Node = node.parent;
        while (!scope(owner)) owner = owner.parent;
        const values = scopes.get(owner) ?? new Map<string, Binding>();
        values.set(node.name.text, {
          value: node.initializer ?? (ts.isForOfStatement(owner) ? owner.expression : undefined),
          type: node.type,
        });
        scopes.set(owner, values);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return (identifier: ts.Identifier): Binding | undefined => {
    for (let owner: ts.Node | undefined = identifier; owner; owner = owner.parent) {
      const found = scopes.get(owner)?.get(identifier.text);
      if (found) return found;
    }
    return undefined;
  };
}

export function literalKeys(type: ts.TypeNode | undefined): string[] {
  if (!type) return [];
  if (ts.isUnionTypeNode(type)) return type.types.flatMap(literalKeys);
  return ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal) ? [type.literal.text] : [];
}

export function boundValue(input: LengthSource, name: ts.Identifier) {
  const binding = input.binding(name);
  if (binding) return binding.value ? { input, value: binding.value } : undefined;
  const linked = input.links.get(name.text),
    value = linked?.source.constants.get(linked.name);
  return linked && value ? { input: linked.source, value } : undefined;
}
export function propertyKeys(
  input: LengthSource,
  expression: ts.Expression,
  seen = new Set<ts.Node>()
): string[] {
  const value = unwrap(expression);
  if (seen.has(value)) return [];
  seen.add(value);
  if (ts.isStringLiteral(value)) return [value.text];
  if (ts.isArrayLiteralExpression(value))
    return value.elements.flatMap((item) => propertyKeys(input, item, seen));
  if (!ts.isIdentifier(value)) return [];
  const target = boundValue(input, value);
  return target
    ? propertyKeys(target.input, target.value, seen)
    : literalKeys(input.binding(value)?.type);
}
