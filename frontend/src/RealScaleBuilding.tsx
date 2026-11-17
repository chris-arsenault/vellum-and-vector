import { useState } from "react";
import type { JsonValue, MapFeature } from "@atlas/map";
import { useBuildingArt } from "./buildingArt";
import { labelOfUse } from "./realScaleTown";
import { vectorFamily } from "./publishedAppearance";
import { OpenFloors } from "./RealScaleFloors";
import "./realScaleBuilding.css";

const text = (value: JsonValue | undefined) =>
  typeof value === "string" || typeof value === "number" ? String(value) : null;

/** The building panel for a selected building; nothing for other shapes. */
export function BuildingFacts({ feature }: { feature: MapFeature }) {
  const building = vectorFamily(feature.layerId) === "structures" && feature.kind === "building";
  return building ? <RealScaleBuilding feature={feature} /> : null;
}
/** A building as a town knows it: use, who lives there, its storeys, keeper and address. */
export function RealScaleBuilding({ feature }: { feature: MapFeature }) {
  const values = feature.attributes;
  const use = text(values.use) ?? "building";
  const rows: [string, string | null][] = [
    ["Use", labelOfUse(use)],
    ["Occupants", text(values.occupants)],
    ["Storeys", text(values.storeys)],
    ["Keeper", text(values.household) ?? text(values.business)],
    ["Address", text(values.address)],
  ];
  return (
    <section aria-label="Building" className="real-scale-building">
      <BuildingArt key={use} use={use} />
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd aria-label={label}>{value ?? "None"}</dd>
          </div>
        ))}
      </dl>
      <OpenFloors feature={feature} />
    </section>
  );
}
/** The art shipped for this use, or a plain placeholder naming the use. */
function BuildingArt({ use }: { use: string }) {
  const source = useBuildingArt(use);
  const [missing, setMissing] = useState(false);
  const label = labelOfUse(use);
  if (!source || missing)
    return (
      <div role="img" aria-label={`No art for ${label} yet`} className="building-art-placeholder">
        {label}
      </div>
    );
  return (
    <img
      className="building-art"
      src={source}
      alt={`${label} art`}
      onError={() => setMissing(true)}
    />
  );
}
