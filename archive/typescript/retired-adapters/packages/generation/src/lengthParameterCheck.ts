import ts from "typescript";

const nameOf = (name: ts.PropertyName) =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : "";
const returnedExpression = (node: ts.Expression | undefined) =>
  node && ts.isArrowFunction(node) && !ts.isBlock(node.body) ? node.body : undefined;

function generatedDefault(
  expression: ts.Expression | undefined,
  relativeMeasure: (expression: ts.Expression) => boolean,
  binding: (identifier: ts.Identifier) => ts.Expression | undefined,
  seen = new Set<string>()
): boolean {
  if (!expression) return false;
  if (ts.isParenthesizedExpression(expression))
    return generatedDefault(expression.expression, relativeMeasure, binding, seen);
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
    const name = expression.expression.text;
    if (seen.has(name)) return false;
    seen.add(name);
    return generatedDefault(
      returnedExpression(binding(expression.expression)),
      relativeMeasure,
      binding,
      seen
    );
  }
  return (
    ts.isObjectLiteralExpression(expression) &&
    expression.properties.some(
      (field) =>
        ts.isPropertyAssignment(field) &&
        nameOf(field.name) === "default" &&
        relativeMeasure(field.initializer)
    )
  );
}

/** Absolute display metadata may coexist with a separately declared relative generated default. */
export function absoluteLengthParameter(
  node: ts.Node,
  relativeMeasure: (expression: ts.Expression) => boolean,
  binding: (identifier: ts.Identifier) => ts.Expression | undefined
) {
  if (!ts.isObjectLiteralExpression(node)) return false;
  const fields = node.properties.filter(ts.isPropertyAssignment),
    unit = fields.find((field) => nameOf(field.name) === "unit")?.initializer,
    generated = fields.find((field) => nameOf(field.name) === "generated")?.initializer;
  return (
    fields.some((field) => nameOf(field.name) === "default") &&
    !generatedDefault(generated, relativeMeasure, binding) &&
    !!unit &&
    ts.isStringLiteral(unit) &&
    /(?:^|\/)(?:metre|kilometre|millimetre|square-metre|cubic-metre|m|km|mm|ft)(?:[²³23])?(?:$|\/)/.test(
      unit.text
    ) &&
    unit.text.split("/")[0] !== unit.text.split("/")[1]
  );
}
