import type { MapDescriptor } from "@atlas/map";
import { shownSpace, undergroundSpace, type RealScalePresentation } from "./realScale";

interface Props {
  map: MapDescriptor;
  view: RealScalePresentation;
  set(next: Partial<RealScalePresentation>): void;
}
/** On a ground map with caves, chooses whether the view shows the surface or the caves. */
export function RealScaleLevel({ map, view, set }: Props) {
  const underground = undergroundSpace(map);
  if (!underground) return null;
  const shown = shownSpace(map, view);
  const levels = [
    { id: map.primarySpaceId, label: "Surface" },
    { id: underground.id, label: "Caves" },
  ];
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
