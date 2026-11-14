import type { LayerStyle, FeatureType, FeatureTypeStyle } from "./types";

export const featureGroupKey = (path: string[]) => JSON.stringify(path);
export function typePresentation(type: Pick<FeatureType, "id" | "path">, style: LayerStyle) {
  const own: FeatureTypeStyle = style.types?.[type.id] ?? {};
  const grouped = type.path.some(
    (_, i) => style.groups?.[featureGroupKey(type.path.slice(0, i + 1))] === false
  );
  return { ...style, ...own, visible: style.visible && !grouped && own.visible !== false };
}

/** Switching one type on keeps every untargeted sibling at its current visibility. */
export function setTypeVisibility(
  style: LayerStyle,
  layerTypes: FeatureType[],
  targets: ReadonlySet<string>,
  visible: boolean
): LayerStyle {
  const types: Record<string, FeatureTypeStyle> = { ...style.types };
  for (const type of layerTypes)
    types[type.id] = {
      ...types[type.id],
      visible: targets.has(type.id) ? visible : typePresentation(type, style).visible,
    };
  return {
    ...style,
    groups: {},
    types,
    visible: layerTypes.some((type) => types[type.id].visible),
  };
}
