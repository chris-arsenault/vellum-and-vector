import { Circle, Fill, RegularShape, Stroke, Style, Text } from "ol/style.js";
import type { AtlasFeature, LayerStyle } from "./types";

export function settlementPriority(feature: AtlasFeature) {
  const role = feature.attributes.settlementRole;
  const rank =
    role === "capital" ? 4 : role === "regionalCapital" ? 3 : role === "marketTown" ? 2 : 1;
  return rank * 1e9 + Math.max(0, Number(feature.attributes.population ?? 0));
}
/** Creation-profile publication owns feature eligibility; zoom never reveals latent towns. */
export function settlementStyle(feature: AtlasFeature, layer: LayerStyle) {
  const role = feature.attributes.settlementRole;
  const capital = role === "capital",
    regional = role === "regionalCapital";
  const center = regional || role === "marketTown";
  const people = Number(feature.attributes.population ?? 0);
  const deserted = ["abandoned", "ruined"].includes(String(feature.attributes.status));
  const color = deserted ? "#786f61" : layer.color;
  const radius = capital ? 8 : center ? 6 : Math.min(6, 2.5 + Math.log10(1 + people) * 0.6);
  const symbol = {
    radius,
    fill: new Fill({ color: deserted ? "#ede6d0" : color }),
    stroke: new Stroke({ color: "#293b3a", width: capital ? 2 : 1.5 }),
    declutterMode: "none" as const,
  };
  return new Style({
    zIndex: settlementPriority(feature),
    image: settlementSymbol(symbol, capital, regional, deserted),
    text: layer.labels
      ? new Text({
          text: feature.name,
          offsetY: -radius - 9,
          font: settlementFont(role),
          fill: new Fill({ color: "#263b39" }),
          stroke: new Stroke({ color: "#f4ecd6", width: 3 }),
        })
      : undefined,
  });
}
function settlementFont(role: unknown) {
  if (role === "capital") return "600 14px system-ui";
  return ["regionalCapital", "marketTown"].includes(String(role))
    ? "600 12px system-ui"
    : "12px system-ui";
}
function settlementSymbol(
  symbol: ConstructorParameters<typeof Circle>[0],
  capital: boolean,
  regional: boolean,
  deserted: boolean
) {
  if (capital) return new RegularShape({ ...symbol, radius: 8, points: 5, radius2: 3.5 });
  if (regional) return new RegularShape({ ...symbol, radius: 6, points: 4, angle: 0 });
  if (deserted)
    return new RegularShape({ ...symbol, radius: 5, points: 4, radius2: 0, angle: Math.PI / 4 });
  return new Circle(symbol);
}
