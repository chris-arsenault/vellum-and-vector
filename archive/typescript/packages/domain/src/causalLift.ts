import type { Geometry } from "geojson";
import type { World } from "./model";
import { spatial } from "./spatial";
import { requireThat } from "./errors";

export function validateCausalLift(
  world: Pick<World, "areas">,
  areaId: string,
  cause: unknown,
  ascents: { geometry: Geometry; rise: number }[]
): void {
  if (!ascents.length) return;
  requireThat(
    typeof cause === "string" && cause.trim().length > 0,
    "uphill_river",
    "A climbing river needs an explicit causal lift mechanism."
  );
  const exceptions =
    world.areas[areaId]?.traits.filter(
      (t) => t.kind === "exception" && t.cause === cause && t.scope !== null
    ) ?? [];
  const head = ascents.reduce((sum, a) => sum + a.rise, 0);
  const supported = exceptions.some(
    (t) =>
      ((t.field === "riverLift" && t.maximum >= head) ||
        (t.field === "gravity" && t.maximum < 0)) &&
      ascents.every((a) => spatial.covers(t.scope!, a.geometry))
  );
  requireThat(
    supported,
    "unaccounted_lift",
    "The causal source must cover the climbing segments and account for their total lift or reversed gravity."
  );
}
