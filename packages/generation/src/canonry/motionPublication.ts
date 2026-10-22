import { overlayField, type GridSurface } from "@atlas/domain";
import type { PhysicalField } from "./field";

export function provinceBinding(map: PhysicalField, channel: string) {
  const inherited = map.inheritedMotion?.find((input) => input.channel === channel);
  if (inherited) return inherited.source.geography?.provinces?.[channel];
  const values = map.provinces?.fields?.[channel];
  return values ? { partition: map.provinces!, values } : undefined;
}

/** Inherited X/Y can come from different parents. Retain each existing owner
 * until the tectonic producer replaces it, without constructing another field.
 */
export function retainInheritedMotion(map: PhysicalField, target: GridSurface, channel: string) {
  const inherited = map.inheritedMotion?.find((input) => input.channel === channel);
  if (!inherited) return;
  const source = inherited.source;
  if (source.geography?.provinces?.[channel]) {
    for (const overlay of source.overlays ?? [])
      if (overlay.channels.includes(channel)) overlayField(target, overlay.grid, [channel], true);
  } else overlayField(target, source, [channel], true);
}
