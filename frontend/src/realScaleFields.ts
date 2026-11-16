/** Geometry fields on real-scale maps take arithmetic and units: `240 cm`, `3*2 m`, `*2`, `+1.5`. */
const unitMetres: Record<string, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  in: 0.0254,
  '"': 0.0254,
  ft: 0.3048,
  "'": 0.3048,
  yd: 0.9144,
};
export type LengthUnits = "metres" | "feet";

/**
 * A length in metres from what a creator typed. A leading `*`, `/` or `+` applies to the
 * current value; a bare number is in the viewer's units.
 */
export function parseLength(text: string, current: number, units: LengthUnits): number | null {
  const parts = lengthParts(text);
  if (!parts || parts.value === null) return null;
  const { relative, unit, value } = parts;
  if (relative === "*") return current * value;
  if (relative === "/") return value === 0 ? null : current / value;
  const metres = value * (unit ? unitMetres[unit] : unitMetres[units === "feet" ? "ft" : "m"]);
  return relative === "+" ? current + metres : metres;
}
function lengthParts(text: string) {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return null;
  const relative = /^[*/+]/.exec(trimmed)?.[0];
  const body = relative ? trimmed.slice(1) : trimmed;
  const unit = /(mm|cm|km|m|in|ft|yd|'|")\s*$/.exec(body)?.[1];
  const value = evaluate(unit ? body.slice(0, body.length - unit.length) : body);
  return { relative, unit, value };
}
/** An angle in degrees; `+15` and `-15` turn from the current angle. */
export function parseAngle(text: string, current: number): number | null {
  const trimmed = text.trim().replace(/°$/, "");
  const value = evaluate(trimmed.replace(/^\+/, ""));
  if (value === null) return null;
  return /^[+-]/.test(trimmed) ? current + value : value;
}

/** Numbers with + - * / and parentheses; anything else is refused. */
export function evaluate(text: string): number | null {
  const tokens = text.match(/\d*\.?\d+(?:e[+-]?\d+)?|[-+*/()]|\S/gi) ?? [];
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  function primary(): number | null {
    const token = take();
    if (token === "(") {
      const value = sum();
      return take() === ")" ? value : null;
    }
    if (token === "-") {
      const value = primary();
      return value === null ? null : -value;
    }
    const value = Number(token);
    return token !== undefined && Number.isFinite(value) ? value : null;
  }
  function product(): number | null {
    let value = primary();
    while (value !== null && (peek() === "*" || peek() === "/")) {
      const operator = take();
      const right = primary();
      if (right === null) return null;
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }
  function sum(): number | null {
    let value = product();
    while (value !== null && (peek() === "+" || peek() === "-")) {
      const operator = take();
      const right = product();
      if (right === null) return null;
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }
  const result = sum();
  return position === tokens.length && result !== null && Number.isFinite(result) ? result : null;
}
/** A length shown in the viewer's units, short enough for a field. */
export function showLength(metres: number, units: LengthUnits) {
  const value = units === "feet" ? metres / unitMetres.ft : metres;
  return `${Number(value.toFixed(2))} ${units === "feet" ? "ft" : "m"}`;
}
