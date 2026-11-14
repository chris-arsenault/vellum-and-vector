import { describeFeature, type CartographicPresentation } from "@atlas/domain";
import type { AtlasFeature, World } from "./types";
import type { FeatureAppearance, RenderFeature } from "./renderFeature";
import { defaultStyles } from "./presentation";
import { drawnLayerStyles } from "./drawnStyles";

/** Generation-side editor adapter; the published viewer supplies its own map catalogue. */
export function worldFeatureAppearance(world: World): FeatureAppearance<AtlasFeature> {
  return {
    type: (feature) => describeFeature(world, feature),
    name: (feature) => cartographicName(feature, world),
    magic: (feature) => magicCartography(feature, world),
    labelScope: (feature) => feature.areaId,
  };
}
export function cartographicName(feature: RenderFeature, world: World) {
  const identity =
    feature.relations.find((relation) =>
      ["sovereign", "controlledBy", "claimedBy", "administeredBy"].includes(relation.kind)
    )?.targetId ?? feature.id;
  return world.entities[identity]?.name ?? feature.name;
}
export function magicCartography(feature: RenderFeature, world: World) {
  const system = String(feature.attributes.system ?? feature.kind.split(":")[0]);
  const rule = String(feature.attributes.rule ?? feature.kind.split(":")[1]);
  return (
    world.magicSystems
      ?.find((entry) => entry.id === system)
      ?.features.find((entry) => entry.id === rule)?.cartography ??
    (feature.geometry.type.includes("Point")
      ? "site"
      : feature.geometry.type.includes("Line")
        ? "course"
        : "area")
  );
}
export function defaultDrawnStyles(world: World, subject: CartographicPresentation["subject"]) {
  const type = describeFeature(world, { kind: "fault", layerId: "geology", attributes: {} });
  return drawnLayerStyles(defaultStyles(world, subject), type.id);
}
