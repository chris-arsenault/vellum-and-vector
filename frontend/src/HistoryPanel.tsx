import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { atlasWorkspace, undoWorkspaceWorld } from "./atlasWorkspace";
import { ErrorMessage } from "./ErrorMessage";
import { useHistory } from "./useAtlas";
import type { World } from "./types";

export function HistoryPanel({ world }: { world: World }) {
  const history = useHistory(world);
  const cache = useQueryClient();
  const undo = useMutation({
    mutationFn: async (operationId: string) => {
      return undoWorkspaceWorld(world.id, operationId);
    },
    onSuccess: (result) => {
      cache.setQueryData(["world", world.id], result);
      void cache.invalidateQueries({ queryKey: ["history", world.id] });
    },
  });
  return (
    <section>
      <GenerationHistory world={world} />
      <h3>Present-day edits</h3>
      <p className="hint">
        Undo restores the previous session state. Ordinary edits retain completed geographic causes.
      </p>
      {history.data?.map((entry, index) => (
        <div className="history-row" key={entry.operationId}>
          <strong>{entry.kind}</strong>
          <small>
            Revision {entry.version} · {entry.actor}
          </small>
          <time>{new Date(entry.at).toLocaleString()}</time>
          {index === 0 && (
            <button
              className="secondary"
              onClick={() => undo.mutate(entry.operationId)}
              disabled={undo.isPending || history.isFetching}
            >
              Undo latest operation
            </button>
          )}
        </div>
      ))}
      <ErrorMessage error={history.error ?? undo.error} />
    </section>
  );
}
function GenerationHistory({ world }: { world: World }) {
  const [fieldId, setFieldId] = useState("");
  const history = useQuery({
    queryKey: ["field-history", world.id, world.version, fieldId],
    enabled: !!fieldId,
    queryFn: async () => (await atlasWorkspace()).readCauses(world.id, fieldId),
  });
  return (
    <>
      <h3>Generated causes</h3>
      <label>
        Mapped area
        <select value={fieldId} onChange={(event) => setFieldId(event.target.value)}>
          <option value="">Choose an area</option>
          {Object.values(world.areas).map((area) => (
            <option key={area.id} value={area.id}>
              {area.name} · {area.profile}
            </option>
          ))}
        </select>
      </label>
      {history.data?.map((epoch, index) => (
        <details key={index}>
          <summary>{epoch.ancestry.map((e) => e.id).join(" / ") || "Present geography"}</summary>
          {epoch.causes.map((cause, i) => (
            <p key={i} className="hint">
              {cause.kind === "domain" ? cause.description : `${cause.process} · ${cause.kind}`}
            </p>
          ))}
        </details>
      ))}
      <ErrorMessage error={history.error} />
    </>
  );
}
