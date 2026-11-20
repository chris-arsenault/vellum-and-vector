import { useEffect, useMemo, useRef, useState } from "react";
import type { OrphanContext, StoredContext } from "@atlas/context";
import { ErrorMessage } from "./ErrorMessage";
import { DeleteButton, DeleteContextPrompt, NodeView, type TreeState } from "./FinishedContextRows";
import { buildLibrary, mapKey } from "./libraryTree";
import { useContextLibrary, type LibraryProps, type LibraryState } from "./useContextLibrary";

// owner-direction(2026-11-15): list worlds, regions, generations, including orphans; weave it into the UI
export function FinishedMapLibrary(props: LibraryProps) {
  const library = useContextLibrary(props);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = props.context.mode === "backend" ? "Server maps" : "Saved maps";
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog ref={dialog} className="saved-maps-dialog" aria-label={title} onCancel={props.close}>
      <header className="saved-maps-heading">
        <h2>{title}</h2>
        <button
          onClick={() => {
            void library.inventory.refetch();
            void library.jobs.refetch();
          }}
        >
          Refresh library
        </button>
        <button onClick={props.close} aria-label={`Close ${title.toLowerCase()}`}>
          ×
        </button>
      </header>
      {library.inventory.isPending && <p>Loading maps…</p>}
      {library.inventory.data && <LibraryContents library={library} />}
      <DeleteContextPrompt state={library} />
      <ErrorMessage
        error={
          library.inventory.error ??
          library.jobs.error ??
          library.opening.error ??
          library.resume.error ??
          library.remove.error
        }
      />
    </dialog>
  );
}
function LibraryContents({ library }: { library: LibraryState }) {
  const inventory = library.inventory.data!;
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const tree = useMemo(
    () => buildLibrary(inventory, library.jobs.data ?? inventory.jobs),
    [inventory, library.jobs.data]
  );
  const state: TreeState = {
    library,
    collapsed,
    depth: 0,
    toggle: (key) =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
  };
  return (
    <>
      {tree.roots.length === 0 && (
        <p>No worlds yet. Generation results and saved maps appear here.</p>
      )}
      <ul className="lib-tree" aria-label="Worlds, regions and generations">
        {tree.roots.map((node) => (
          <NodeView
            key={node.kind === "map" ? mapKey(node.map) : node.job.jobId}
            node={node}
            tree={state}
          />
        ))}
      </ul>
      <Leftovers library={library} superseded={tree.superseded} detached={tree.detached} />
    </>
  );
}
function MapLine({
  map,
  library,
  note,
  removable,
}: {
  map: StoredContext;
  library: LibraryState;
  note: string;
  removable: boolean;
}) {
  return (
    <li className="lib-row">
      <span className="lib-lead">
        <span className="lib-toggle" />
        <button
          className="lib-name"
          disabled={!!map.problem || library.opening.isPending}
          onClick={() => library.opening.mutate(map)}
        >
          {map.name}
        </button>
      </span>
      <span className="lib-kind">{map.profile}</span>
      <span className="lib-status" title={map.problem ?? undefined}>
        {map.problem ? `cannot open · ${map.problem}` : note}
      </span>
      <span className="lib-actions">
        {removable && (
          <DeleteButton
            label={`Delete ${map.name}`}
            ask={() =>
              library.confirmDelete({
                target: { kind: "map", id: map.reference.mapId, descendants: false },
                name: map.name,
              })
            }
          />
        )}
      </span>
    </li>
  );
}
function OrphanLine({ orphan, library }: { orphan: OrphanContext; library: LibraryState }) {
  return (
    <li className="lib-row">
      <span className="lib-lead">
        <span className="lib-toggle" />
        <span className="lib-name">{orphan.reference?.mapId ?? orphan.id}</span>
      </span>
      <span className="lib-kind">{orphan.kind}</span>
      <span className="lib-status">{orphan.problem ?? "no map or job refers to it"}</span>
      <span className="lib-actions">
        <button
          className="lib-text"
          onClick={() =>
            library.confirmDelete({
              target: { kind: "orphan", orphan },
              name: `unattached ${orphan.kind}`,
            })
          }
        >
          Delete unattached {orphan.kind}
        </button>
      </span>
    </li>
  );
}
/** Records that no tree row accounts for: replaced revisions, orphaned data and cleanup left over. */
function Leftovers({
  library,
  superseded,
  detached,
}: {
  library: LibraryState;
  superseded: StoredContext[];
  detached: StoredContext[];
}) {
  const inventory = library.inventory.data!;
  const count = superseded.length + detached.length + inventory.orphans.length;
  if (!count && !inventory.problems.length && !inventory.cleanup.length) return null;
  return (
    <details className="lib-leftovers">
      <summary>Older revisions and unattached records ({count})</summary>
      <ul className="lib-tree">
        {detached.map((map) => (
          <MapLine
            key={mapKey(map)}
            map={map}
            library={library}
            note="its parent map is gone"
            removable
          />
        ))}
        {superseded.map((map) => (
          <MapLine
            key={mapKey(map)}
            map={map}
            library={library}
            note="replaced by a newer revision"
            removable={false}
          />
        ))}
        {inventory.orphans.map((orphan) => (
          <OrphanLine key={`${orphan.kind}:${orphan.id}`} orphan={orphan} library={library} />
        ))}
      </ul>
      {inventory.problems.map((problem) => (
        <p role="status" key={problem}>
          {problem}
        </p>
      ))}
      {inventory.cleanup.map((id) => (
        <p key={id}>
          Unfinished cleanup{" "}
          <button
            disabled={library.remove.isPending}
            onClick={() => library.remove.mutate({ kind: "cleanup", id })}
          >
            Retry cleanup
          </button>
        </p>
      ))}
    </details>
  );
}
