import { useEffect, useRef, useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorMessage } from "./ErrorMessage";
import { listSavedMaps, openSavedMap, saveMap, type SavedMapSummary } from "./savedMaps";
import { useJobs } from "./useAtlas";
import type { World } from "./types";

export function MapStorage({ world, onOpen }: { world?: World; onOpen: (id: string) => void }) {
  const [picking, setPicking] = useState(false);
  const cache = useQueryClient();
  const saved = useQuery({ queryKey: ["saved-maps"], queryFn: listSavedMaps });
  const busy = useWorldBusy(world?.id);
  const save = useMutation({
    mutationFn: saveMap,
    onSuccess: () => cache.invalidateQueries({ queryKey: ["saved-maps"] }),
  });
  const summary = saved.data?.find((entry) => entry.id === world?.id);
  return (
    <div className="map-storage">
      {world && (
        <>
          <span className="header-meta" role="status">
            {saveStatus(summary, world.version)}
          </span>
          <button
            className="quiet"
            disabled={save.isPending || busy}
            onClick={() => save.mutate(world.id)}
          >
            {save.isPending ? "Saving…" : "Save map"}
          </button>
        </>
      )}
      <button className="quiet" onClick={() => setPicking(true)}>
        Saved maps
      </button>
      <ErrorMessage error={save.error} />
      {picking && <SavedMapPicker onClose={() => setPicking(false)} onOpen={onOpen} />}
    </div>
  );
}

function useWorldBusy(worldId?: string) {
  const jobs = useJobs(worldId ?? "");
  const commands = useIsMutating({ mutationKey: ["command", worldId] });
  return commands > 0 || jobs.data?.some((job) => job.status === "running");
}
function saveStatus(summary: SavedMapSummary | undefined, version: number) {
  if (!summary) return "Session only · not saved";
  return summary.version === version ? "Saved locally" : "Unsaved changes";
}

function SavedMapPicker({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cache = useQueryClient();
  const maps = useQuery({ queryKey: ["saved-maps"], queryFn: listSavedMaps });
  const open = useMutation({
    mutationFn: openSavedMap,
    onSuccess: async (world) => {
      await cache.invalidateQueries();
      cache.setQueryData(["world", world.id], world);
      onOpen(world.id);
      onClose();
    },
  });
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog className="saved-maps-dialog" ref={dialog} aria-label="Saved maps" onCancel={onClose}>
      <header className="saved-maps-heading">
        <h2>Saved maps</h2>
        <button className="quiet" aria-label="Close saved maps" onClick={onClose}>
          ×
        </button>
      </header>
      <p className="hint">
        Saved in this browser. Opening a save replaces that world's current session copy.
      </p>
      {maps.isPending && <p>Loading saved maps…</p>}
      {maps.data?.length === 0 && <p>No saved maps yet. Open a world and choose Save map.</p>}
      <div className="saved-map-list">
        {maps.data?.map((map) => (
          <button key={map.id} disabled={open.isPending} onClick={() => open.mutate(map.id)}>
            <strong>{map.name}</strong>
            <small>
              Revision {map.version} · {new Date(map.savedAt).toLocaleString()}
            </small>
          </button>
        ))}
      </div>
      <ErrorMessage error={maps.error ?? open.error} />
    </dialog>
  );
}
