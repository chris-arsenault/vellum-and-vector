import type { MapDescriptor, Position, RealScale, RegionSelection } from "@atlas/map";
import type { HexSize, RealScaleChoice } from "@atlas/context";
import type { LayerStyle } from "./types";
import { vectorFamily } from "./publishedAppearance";

/** Real-scale view choices; hex marks and shapes stay published map data (ADR 0016). */
export interface RealScalePresentation {
  hexView: "grid" | "fill";
  units: "metres" | "feet";
  /** Creator layers hidden in this view. */
  hidden: string[];
}
export const defaultRealScalePresentation = (): RealScalePresentation => ({
  hexView: "grid",
  units: "metres",
  hidden: [],
});

/** Drawing order of real-scale layer kinds, bottom first. Unlisted layers draw beneath. */
export const realScaleOrder = [
  "oceans",
  "lakes",
  "rivers",
  "waterworks",
  "plots",
  "roads",
  "structures",
  "ruins",
  "objects",
  "hexes",
];
const rank = (layerId: string) => realScaleOrder.indexOf(vectorFamily(layerId));

/** The first style draws on top, so real-scale kinds sort top first and show by default. */
export function realScaleStyles(styles: LayerStyle[]): LayerStyle[] {
  return styles
    .map((style) => (rank(style.layerId) >= 0 ? { ...style, visible: true, labels: true } : style))
    .sort((a, b) => rank(b.layerId) - rank(a.layerId));
}
export const isRealScaleLayer = (layerId: string) => rank(layerId) >= 0;

export const hexSizes: { value: HexSize; metres: number; feet: number; use: string }[] = [
  { value: "1.5m", metres: 1.5, feet: 5, use: "Tactical combat" },
  { value: "3m", metres: 3, feet: 10, use: "Rooms and small buildings" },
  { value: "10m", metres: 10, feet: 30, use: "Buildings and compounds" },
  { value: "30m", metres: 30, feet: 100, use: "Streets and villages" },
  { value: "100m", metres: 100, feet: 330, use: "Towns and local wilderness" },
  { value: "300m", metres: 300, feet: 1000, use: "Forests, glens and valleys" },
];
export const mapSizes = [
  { hexesAcross: 30, label: "Small" },
  { hexesAcross: 50, label: "Medium" },
  { hexesAcross: 80, label: "Large" },
];

/** A distance in the viewer's units, with a unit a tabletop reader expects. */
export function formatDistance(metres: number, units: RealScalePresentation["units"]) {
  if (units === "feet") {
    const feet = metres / 0.3048;
    return feet >= 5280 ? `${(feet / 5280).toFixed(2)} mi` : `${Math.round(feet)} ft`;
  }
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${metres.toFixed(1)} m`;
}
export function hexLabel(real: RealScale, units: RealScalePresentation["units"]) {
  return units === "feet" ? `${real.feet} ft hexes` : `${real.acrossFlats} m hexes`;
}

/** Width and height of the map a choice opens, in metres; the frame is 4:3. */
export function realScaleFrame(choice: RealScaleChoice) {
  const size = hexSizes.find((entry) => entry.value === choice.hexSize)!;
  const width = choice.hexesAcross * size.metres;
  return { width, height: width * 0.75 };
}

/** A small outline around the clicked point; the engine centres the map's frame on it. */
export function pointSelection(
  map: MapDescriptor,
  spaceId: string,
  position: Position
): RegionSelection {
  const [x, y] = position;
  const d = 1e-3;
  const ring: Position[] = [
    [x - d, y - d],
    [x + d, y - d],
    [x + d, y + d],
    [x - d, y + d],
    [x - d, y - d],
  ];
  return {
    parent: map.reference,
    spaceId,
    geometry: { type: "Polygon", coordinates: [ring] },
    featureIds: [],
    regionPath: [],
  };
}
