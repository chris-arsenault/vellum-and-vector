import { societyWorkNatures } from "./society";

/** Display an already resolved catalogue value; no feature composition or world reads. */
export function registryCell(
  row: { values: Record<string, unknown>; feature: { attributes: Record<string, unknown> } },
  column: { key: string }
) {
  if (column.key === "space") return String(row.values.spaceLabel);
  const value = row.values[column.key];
  if (value == null || value === "") return "Unknown";
  const display =
    typeof value === "number"
      ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : String(value);
  const kind = row.feature.attributes.workKind as keyof typeof societyWorkNatures;
  return column.key === "magnitude" && societyWorkNatures[kind]
    ? `${display} ${societyWorkNatures[kind].unit}`
    : display;
}
