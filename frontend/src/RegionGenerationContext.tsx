import { effectiveTraits, type World } from "@atlas/domain";
import { bounds } from "./presentation";

export function RegionGenerationContext({ world, areaId }: { world: World; areaId: string }) {
  const area = world.areas[areaId],
    parent = area.parentId ? world.areas[area.parentId] : null;
  const traits = effectiveTraits(world.areas, area.id);
  const extent = bounds(area.footprint);
  return (
    <details className="setup-region-context">
      <summary>
        Inherited context · {parent?.name ?? world.name} · {area.boundary?.crossings.length ?? 0}{" "}
        locked crossings
      </summary>
      <p>
        {area.profile} · {((extent[2] - extent[0]) / 1000).toLocaleString()} ×{" "}
        {((extent[3] - extent[1]) / 1000).toLocaleString()} km. Completed physical epochs and system
        definitions are inherited; local generation preserves fixed crossings and protected
        geography.
      </p>
      <h3>Effective spatial traits</h3>
      {traits.length ? (
        <ul>
          {traits.map((trait, index) => (
            <li key={index}>
              {trait.field} · {trait.kind} · {trait.minimum}–{trait.maximum}
              {trait.scope ? " · scoped within this area" : " · whole area"}
            </li>
          ))}
        </ul>
      ) : (
        <p>No additional spatial constraints.</p>
      )}
    </details>
  );
}
