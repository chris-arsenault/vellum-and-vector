export function inspectionWords(value: string) {
  const spaced = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
export function inspectionFact(value: unknown): string {
  if (value === null || value === undefined) return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number")
    return Number.isInteger(value)
      ? value.toLocaleString()
      : Number(value.toPrecision(4)).toLocaleString();
  if (Array.isArray(value)) return value.map(inspectionFact).join(", ") || "None";
  if (typeof value === "object")
    return Object.entries(value)
      .map(([key, item]) => `${inspectionWords(key)}: ${inspectionFact(item)}`)
      .join("; ");
  return String(value);
}
