import ts from "typescript";
import { absoluteLengthParameter } from "./lengthParameterCheck";
import {
  lengthSource,
  linkLengthImports,
  boundValue,
  propertyKeys,
  unwrap,
  type LengthSource as Source,
} from "./lengthBindings";

export interface LengthFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly detail: string;
  readonly certainty: "boundary" | "inventory";
}
const legacyNames = new Set(["continentalWorldProfile"]);
const dimensions =
  /(?:length|radius|height|depth|distance|reach|spacing|width|area|volume|elevation|travel|thickness)$/i;
const declarations = new Set(["length", "area", "volume", "inverseLength", "measure"]);
const codecs = new Set(["native", "metres", "inUnits", "areaUnits", "volumeUnits"]);
const nameOf = (name: ts.Node | undefined) =>
  name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : "";

function scaleClass(input: Source, expression: ts.Expression, seen = new Set<string>()): boolean {
  const value = unwrap(expression);
  if (!ts.isIdentifier(value)) return false;
  const binding = input.binding(value);
  if (!binding && input.scales.has(value.text)) return true;
  if (seen.has(value.text)) return false;
  seen.add(value.text);
  const alias = binding?.value;
  return alias ? scaleClass(input, alias, seen) : false;
}
function scaleMethod(input: Source, expression: ts.Expression) {
  return ts.isPropertyAccessExpression(expression) && scaleClass(input, expression.expression)
    ? expression.name.text
    : "";
}
function constant(
  input: Source,
  expression: ts.Expression,
  seen = new Set<string>()
): number | null {
  const value = unwrap(expression);
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (ts.isBinaryExpression(value)) return binaryConstant(input, value, seen);
  if (ts.isPrefixUnaryExpression(value)) {
    const operand = constant(input, value.operand, seen);
    return operand === null
      ? null
      : value.operator === ts.SyntaxKind.MinusToken
        ? -operand
        : operand;
  }
  if (!ts.isIdentifier(value)) return null;
  return namedConstant(input, value, seen);
}
function binaryConstant(input: Source, node: ts.BinaryExpression, seen: Set<string>) {
  const left = constant(input, node.left, new Set(seen)),
    right = constant(input, node.right, new Set(seen));
  if (left === null || right === null) return null;
  switch (node.operatorToken.kind) {
    case ts.SyntaxKind.PlusToken:
      return left + right;
    case ts.SyntaxKind.MinusToken:
      return left - right;
    case ts.SyntaxKind.AsteriskToken:
      return left * right;
    case ts.SyntaxKind.SlashToken:
      return left / right;
    case ts.SyntaxKind.AsteriskAsteriskToken:
      return left ** right;
    default:
      return null;
  }
}
function namedConstant(input: Source, name: ts.Identifier, seen: Set<string>): number | null {
  const key = `${input.file.fileName}:${name.pos}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const target = boundValue(input, name);
  return target ? constant(target.input, target.value, seen) : null;
}
/** Follow constant aliases and min/max bounds, not arbitrary numeric physical computations. */
function fixedDimension(
  input: Source,
  expression: ts.Expression,
  seen = new Set<string>()
): boolean {
  const value = unwrap(expression),
    numeric = constant(input, value);
  if (numeric !== null) return numeric !== 0;
  if (ts.isArrayLiteralExpression(value))
    return value.elements.some((element) => fixedDimension(input, element, new Set(seen)));
  if (ts.isElementAccessExpression(value)) return fixedDimension(input, value.expression, seen);
  if (ts.isIdentifier(value)) return fixedAlias(input, value, seen);
  if (ts.isConditionalExpression(value))
    return (
      fixedDimension(input, value.whenTrue, new Set(seen)) ||
      fixedDimension(input, value.whenFalse, new Set(seen))
    );
  return fixedBound(input, value, seen);
}
function fixedBound(input: Source, value: ts.Expression, seen: Set<string>) {
  if (!ts.isCallExpression(value) || !ts.isPropertyAccessExpression(value.expression)) return false;
  if (codecs.has(scaleMethod(input, value.expression)))
    return !!value.arguments[0] && fixedDimension(input, value.arguments[0], seen);
  const call = value.expression;
  return (
    call.expression.getText(input.file) === "Math" &&
    ["min", "max"].includes(call.name.text) &&
    value.arguments.some((argument) => fixedDimension(input, argument, new Set(seen)))
  );
}
function fixedAlias(input: Source, name: ts.Identifier, seen: Set<string>): boolean {
  const key = `${input.file.fileName}:${name.pos}`;
  if (seen.has(key)) return false;
  seen.add(key);
  const target = boundValue(input, name);
  return target ? fixedDimension(target.input, target.value, seen) : false;
}
function declaresMeasure(
  input: Source,
  expression: ts.Expression,
  seen = new Set<ts.Node>()
): boolean {
  const value = unwrap(expression);
  if (seen.has(value)) return false;
  seen.add(value);
  if (ts.isIdentifier(value)) {
    const target = boundValue(input, value);
    return !!target && declaresMeasure(target.input, target.value, seen);
  }
  return ts.isArrayLiteralExpression(value)
    ? value.elements.some((element) => declaresMeasure(input, element, seen))
    : ts.isCallExpression(value) && declarations.has(scaleMethod(input, value.expression));
}
function definitionKeys(inputs: Source[]) {
  const keys = new Set<string>();
  for (const input of inputs) {
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAssignment(node) &&
        definitionContext(input, node) &&
        declaresMeasure(input, node.initializer)
      )
        keys.add(nameOf(node.name));
      ts.forEachChild(node, visit);
    };
    visit(input.file);
  }
  return keys;
}
const dimensionName = (name: string, keys: Set<string>) => keys.has(name) || dimensions.test(name);
function assignedProperty(
  input: Source,
  keys: Set<string>,
  node: ts.BinaryExpression
): [string, ts.Expression] | undefined {
  if (ts.isPropertyAccessExpression(node.left)) return [node.left.name.text, node.right];
  if (!ts.isElementAccessExpression(node.left)) return undefined;
  const name = propertyKeys(input, node.left.argumentExpression).find((key) =>
    dimensionName(key, keys)
  );
  return name ? [name, node.right] : undefined;
}
function assignedDimension(
  input: Source,
  keys: Set<string>,
  node: ts.Node
): [string, ts.Expression] | undefined {
  if (ts.isVariableDeclaration(node) && node.initializer)
    return [nameOf(node.name), node.initializer];
  if (ts.isPropertyAssignment(node)) return [nameOf(node.name), node.initializer];
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken)
    return assignedProperty(input, keys, node);
  return undefined;
}
/** Numeric resolve overrides are declared fractions, not already-resolved physical lengths. */
function relativeOverride(node: ts.Node) {
  const object = node.parent;
  if (!ts.isObjectLiteralExpression(object)) return false;
  const call = object.parent;
  return (
    ts.isCallExpression(call) &&
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "resolve" &&
    call.arguments[1] === object
  );
}
function legacyImport(node: ts.Node) {
  if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node))
    return legacyNames.has(node.propertyName?.text ?? node.name.text);
  return false;
}
function nativeArithmetic(input: Source, node: ts.Node) {
  if (!ts.isBinaryExpression(node)) return false;
  if (![ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken].includes(node.operatorToken.kind))
    return false;
  return [node.left, node.right].some(
    (operand) => Math.abs(constant(input, operand) ?? 0) === 1024
  );
}
function fixedAssignment(input: Source, keys: Set<string>, node: ts.Node) {
  const assignment = assignedDimension(input, keys, node);
  return assignment &&
    dimensionName(assignment[0], keys) &&
    !relativeOverride(node) &&
    !fixedCodec(input, unwrap(assignment[1])) &&
    fixedDimension(input, assignment[1])
    ? assignment[0]
    : undefined;
}
/** A local unit declaration disambiguates numeric names, never encoding or parameter rules. */
function nonLengthUnit(input: Source, node: ts.Node) {
  const declaration =
    ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    node.parent.declarations[0] === node
      ? node.parent.parent
      : node;
  const comments = ts.getLeadingCommentRanges(input.file.text, declaration.getFullStart()) ?? [];
  return comments.some((comment) =>
    /length-unit:\s*(?:fraction|ratio|degrees|count|pixels|bytes)\b/.test(
      input.file.text.slice(comment.pos, comment.end)
    )
  );
}
function generatedConstant(input: Source, node: ts.Node) {
  return (
    /(?:^|\/)generation\/src\//.test(input.file.fileName) &&
    ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    ts.isVariableStatement(node.parent.parent) &&
    ts.isSourceFile(node.parent.parent.parent)
  );
}
function definitionContext(input: Source, node: ts.Node) {
  for (let parent: ts.Node | undefined = node; parent; parent = parent.parent)
    if (input.definitions.has(parent)) return true;
  return false;
}
function markDefinition(input: Source, expression: ts.Expression) {
  const value = unwrap(expression);
  if (input.definitions.has(value)) return;
  input.definitions.add(value);
  if (ts.isIdentifier(value)) {
    const target = boundValue(input, value);
    if (target) markDefinition(target.input, target.value);
  }
  if (ts.isObjectLiteralExpression(value))
    for (const field of value.properties) markDefinitionProperty(input, field);
  if (ts.isArrayLiteralExpression(value))
    for (const entry of value.elements) markDefinition(input, entry);
}
function markDefinitionProperty(input: Source, field: ts.ObjectLiteralElementLike) {
  if (ts.isSpreadAssignment(field)) markDefinition(input, field.expression);
  else if (ts.isPropertyAssignment(field)) markDefinition(input, field.initializer);
  else if (ts.isShorthandPropertyAssignment(field)) markDefinition(input, field.name);
}
function markDefinitions(inputs: Source[]) {
  for (const input of inputs) {
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        scaleMethod(input, node.expression) === "definitions" &&
        node.arguments[0]
      )
        markDefinition(input, node.arguments[0]);
      ts.forEachChild(node, visit);
    };
    visit(input.file);
  }
}
function dimensionalBoundary(input: Source, keys: Set<string>, node: ts.Node, name: string) {
  if (nonLengthUnit(input, node)) return false;
  if (generatedConstant(input, node)) return true;
  if (definitionContext(input, node)) return true;
  if (ts.isBinaryExpression(node) && keys.has(name)) return true;
  return (
    keys.has(name) &&
    !/^(length|radius|height|depth|distance|reach|spacing|width|area|volume)$/i.test(name)
  );
}
function physicalEncoding(input: Source, node: ts.Node) {
  if (/generation\/src\/(world|rock|processes|coupling|regional)\//.test(input.file.fileName))
    return true;
  for (let parent: ts.Node | undefined = node; parent; parent = parent.parent) {
    if (
      ts.isVariableDeclaration(parent) &&
      /convert|encode|decode|native/i.test(nameOf(parent.name)) &&
      !/bytes$/i.test(nameOf(parent.name))
    )
      return true;
  }
  return /Elevation|Thickness|Sediment|\bnative\b/.test(node.getText(input.file));
}
const referenceCall = (input: Source, node: ts.Node) =>
  ts.isCallExpression(node) && scaleMethod(input, node.expression) === "reference";
function fixedCodec(input: Source, node: ts.Node) {
  if (!ts.isCallExpression(node)) return false;
  const name = nameOf(node.expression),
    codec =
      scaleMethod(input, node.expression) === "native" ||
      (definitionContext(input, node) && codecs.has(scaleMethod(input, node.expression))) ||
      input.imports.some((item) => item.local === name && ["units", "toUnits"].includes(item.name));
  return codec && node.arguments.length > 0 && fixedDimension(input, node.arguments[0]);
}
function scaleViolation(input: Source, node: ts.Node) {
  if (referenceCall(input, node))
    return [
      "reference-frame",
      "Runtime geography must use its actual map frame, not MapScale.reference().",
    ];
  if (
    ts.isPropertyAccessExpression(node) &&
    scaleClass(input, node.expression) &&
    node.name.text === "nativePerMetre"
  )
    return ["native-converter", "The native encoding factor belongs inside MapScale."];
  return undefined;
}
function findings(input: Source, keys: Set<string>) {
  const result: LengthFinding[] = [],
    add = (
      node: ts.Node,
      rule: string,
      detail: string,
      certainty: LengthFinding["certainty"] = "boundary"
    ) =>
      result.push({
        file: input.file.fileName,
        line: input.file.getLineAndCharacterOfPosition(node.getStart(input.file)).line + 1,
        rule,
        detail,
        certainty,
      });
  const visit = (node: ts.Node) => {
    if (
      absoluteLengthParameter(
        node,
        (expression) => declaresMeasure(input, expression),
        (identifier) => boundValue(input, identifier)?.value
      )
    )
      add(
        node,
        "absolute-parameter",
        "Generated parameter defaults must declare map-relative units and resolve through MapScale."
      );
    if (legacyImport(node))
      add(
        node,
        "legacy-converter",
        "Use MapScale; aliases and reexports do not create another conversion boundary."
      );
    if (fixedCodec(input, node))
      add(
        node,
        "fixed-dimension",
        "A codec changes encoding, not map scale; resolve this generated length first."
      );
    if (nativeArithmetic(input, node))
      add(
        node,
        "native-converter",
        "Use MapScale for geographic encoding; classify non-geographic binary arithmetic separately.",
        physicalEncoding(input, node) ? "boundary" : "inventory"
      );
    const name = fixedAssignment(input, keys, node);
    if (name)
      add(
        node,
        "fixed-dimension",
        `${name} has a constant source; geographic dimensions require a relative measure.`,
        dimensionalBoundary(input, keys, node, name) ? "boundary" : "inventory"
      );
    const violation = scaleViolation(input, node);
    if (violation) add(node, violation[0], violation[1]);
    ts.forEachChild(node, visit);
  };
  visit(input.file);
  return result;
}

/** A boundary guard and review inventory, not an inference engine for arbitrary arithmetic units.
 * Explicit declaration keys catch aliases/overrides; dimension names additionally flag unclassified
 * new controls. Measured coordinates and ordinary computations are not rescaled by this check. */
export function lengthAuthorityFindings(files: readonly { file: string; text: string }[]) {
  const inputs = files.map(({ file, text }) => lengthSource(file, text));
  linkLengthImports(inputs);
  markDefinitions(inputs);
  const keys = definitionKeys(inputs);
  return inputs.flatMap((input) => findings(input, keys));
}
