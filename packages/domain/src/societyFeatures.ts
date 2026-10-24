import type { AtlasFeature } from "./model";
import type { SocietyWorkKind } from "./society";

export const societyWorkLayers: Record<SocietyWorkKind, string> = {
  dam: "waterworks",
  irrigation: "waterworks",
  pass: "transportSites",
  harbor: "transportSites",
  clearance: "landUse",
  hunting: "landUse",
  conservation: "landUse",
  "fire-forge": "magicPractices",
  "aurora-archive": "magicPractices",
  "pressure-diving": "magicPractices",
  tapping: "magicPractices",
  burning: "landUse",
  quarrying: "magicPractices",
  weir: "waterworks",
};
/** Legacy authored works remain editable; newly published works use their concrete kind. */
export function isSocietyWork(feature: Pick<AtlasFeature, "kind" | "attributes">) {
  return feature.kind === "societyWork" || Object.hasOwn(societyWorkLayers, feature.kind);
}
