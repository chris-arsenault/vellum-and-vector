import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MapFeature } from "@atlas/map";
import { ErrorMessage } from "./ErrorMessage";
import { useStructure } from "./structureServices";
import { isGroundMap } from "./structureMaps";

/** A building on a real-scale ground map opens to its floors: a map of its own levels with
 * the footprint as outer walls and the street door, made by the map store on first opening
 * and reopened after (ADR 0016). */
export function OpenFloors({ feature }: { feature: MapFeature }) {
  const services = useStructure();
  const cache = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!services || !isGroundMap(services.map)) return null;
  const open = async () => {
    setBusy(true);
    try {
      const floors = await services.editing.openFloors(services.map.reference, feature.id);
      // The ground map now lists the floors among its children.
      await cache.invalidateQueries({ queryKey: ["related-maps"] });
      services.open(floors);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="open-floors">
      <button type="button" disabled={busy} onClick={() => void open()}>
        Open floors
      </button>
      <p className="authoring-note">
        A map of this building&apos;s levels: its storeys and a cellar, with the outer walls and
        street door in place. Rooms and furnishings are drawn by hand.
      </p>
      <ErrorMessage error={error} />
    </div>
  );
}
