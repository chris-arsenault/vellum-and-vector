import type { MapDescriptor } from "@atlas/map";
import { shownSpace, undergroundSpace, type RealScalePresentation } from "./realScale";
import { isStructureMap, structureLevels } from "./structureMaps";

interface Props {
  map: MapDescriptor;
  view: RealScalePresentation;
  set(next: Partial<RealScalePresentation>): void;
}
/** The located spaces a view can show: a building's levels, top floor first, or on a ground
 * map with caves the surface and the caves. */
function levelChoices(map: MapDescriptor) {
  if (isStructureMap(map))
    return structureLevels(map).map((level) => ({ id: level.spaceId, label: level.label }));
  const underground = undergroundSpace(map);
  return underground
    ? [
        { id: map.primarySpaceId, label: "Surface" },
        { id: underground.id, label: "Caves" },
      ]
    : [];
}
/** Chooses which level the view shows. */
export function RealScaleLevel({ map, view, set }: Props) {
  const levels = levelChoices(map);
  if (levels.length < 2) return null;
  const shown = shownSpace(map, view);
  return (
    <fieldset>
      <legend>Level</legend>
      {levels.map((level) => (
        <label key={level.id} className="check">
          <input
            type="radio"
            name="real-scale-level"
            checked={shown === level.id}
            onChange={() => set({ space: level.id })}
          />
          {level.label}
        </label>
      ))}
    </fieldset>
  );
}
