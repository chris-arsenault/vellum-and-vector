import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { JsonValue, MapDescriptor, MapNavigationState, SavedMapDocument } from "@atlas/map";
import type { FinishedContext } from "./App";
import type { PublishedPresentation } from "./PublishedMapView";
import { initialPublishedPresentation } from "./publishedStyling";
import { sameValue } from "./values";
import { ErrorMessage } from "./ErrorMessage";
import { useSavedFloors } from "./structureSave";

interface Props {
  context: Pick<FinishedContext, "mode" | "library">;
  map: MapDescriptor;
  saved?: SavedMapDocument;
  value: PublishedPresentation;
  navigation: MapNavigationState | null;
  /** Edits applied to a real-scale map; the saved count tells whether they are saved. */
  edits: number;
}
export function FinishedSave({ context, map, saved, value, navigation, edits }: Props) {
  const cache = useQueryClient();
  const [stored, setStored] = useState(saved);
  // A ground map's building floors are kept with it; new or edited floors are unsaved changes.
  const { floors, unchanged, reading } = useSavedFloors(map, stored);
  const clean = unchanged && matchesSavedView(map, stored, value, navigation, edits);
  const save = useMutation({
    mutationFn: async () => {
      if (!navigation) throw new Error("Wait for map regions and views to load.");
      return context.library.save({
        reference: map.reference,
        expectedVersion: stored?.version ?? null,
        navigation,
        settings: { presentation: value as unknown as JsonValue, edits, floors },
      });
    },
    onSuccess: (saved) => {
      setStored(saved);
      void cache.invalidateQueries({ queryKey: ["saved-maps"] });
    },
  });
  const persist = save.mutate;
  // Save waits while the building floors are read, so it records them as they stand.
  const ready = navigation !== null && map.state === "complete" && !reading;
  const automatic = context.mode === "backend" && !clean && ready;
  // owner-direction(2026-11-15): server maps and their view preferences do not require a Save action
  useEffect(() => {
    if (!automatic || save.isPending || save.isError) return;
    const timer = setTimeout(() => persist(), 500);
    return () => clearTimeout(timer);
  }, [automatic, navigation, value, save.isPending, save.isError, persist]);
  return (
    <div className="map-storage">
      <span role="status">{storageLabel(context.mode, save.isPending, !!stored, clean)}</span>
      {(context.mode === "browser" || save.isError) && (
        <button disabled={save.isPending || !ready} onClick={() => save.mutate()}>
          {saveLabel(context.mode, save.isPending)}
        </button>
      )}
      <ErrorMessage error={save.error} />
    </div>
  );
}
function storageLabel(mode: string, pending: boolean, stored: boolean, clean: boolean) {
  if (mode === "backend") return pending ? "Saving view…" : "Stored on server";
  if (!stored) return "Not saved";
  return clean ? "Saved" : "Unsaved changes";
}
function saveLabel(mode: string, pending: boolean) {
  if (pending) return "Saving…";
  return mode === "backend" ? "Retry saving view" : "Save map";
}
function matchesSavedView(
  map: MapDescriptor,
  saved: SavedMapDocument | undefined,
  value: PublishedPresentation,
  navigation: MapNavigationState | null,
  edits: number
) {
  return (
    saved?.reference.revision === map.reference.revision &&
    sameValue(value, saved.settings.presentation ?? initialPublishedPresentation(map)) &&
    navigation?.version === saved.navigation.version &&
    (saved.settings.edits ?? 0) === edits
  );
}
