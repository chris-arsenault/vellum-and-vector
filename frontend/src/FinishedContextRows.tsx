import { useEffect, useRef, type ReactNode } from "react";
import type { DeleteContext, GenerationStatus, StoredContext } from "@atlas/context";
import { mapKey, type LibraryNode, type MapNode } from "./libraryTree";
import type { LibraryState } from "./useContextLibrary";

export interface TreeState {
  library: LibraryState;
  collapsed: Set<string>;
  /** Nesting level of the rows being drawn, for indentation. */
  depth: number;
  toggle(key: string): void;
}
const jobName = (job: GenerationStatus) => job.details?.name ?? job.step;
const jobKey = (job: GenerationStatus) => `job:${job.jobId}`;

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor">
      <path d="M6 1h4l.5 1H14v2H2V2h3.5L6 1zM3 5h10l-.7 9.1a1 1 0 0 1-1 .9H4.7a1 1 0 0 1-1-.9L3 5z" />
    </svg>
  );
}
export function DeleteButton({
  label,
  disabled,
  ask,
}: {
  label: string;
  disabled?: boolean;
  ask(): void;
}) {
  return (
    <button className="lib-icon" aria-label={label} title={label} disabled={disabled} onClick={ask}>
      <TrashIcon />
    </button>
  );
}
function Row({
  node,
  tree,
  name,
  kind,
  status,
  actions,
}: {
  node: LibraryNode;
  tree: TreeState;
  name: ReactNode;
  kind?: string;
  status: ReactNode;
  actions: ReactNode;
}) {
  const key = node.kind === "map" ? mapKey(node.map) : jobKey(node.job);
  const open = !tree.collapsed.has(key);
  const label = node.kind === "map" ? node.map.name : jobName(node.job);
  const row = (
    <li className="lib-row">
      <span className={`lib-lead lib-depth-${Math.min(tree.depth, 6)}`}>
        {node.children.length ? (
          <button
            className="lib-toggle"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
            onClick={() => tree.toggle(key)}
          >
            <span className="lib-chevron" data-open={open} aria-hidden="true" />
          </button>
        ) : (
          <span className="lib-toggle" />
        )}
        {name}
      </span>
      <span className="lib-kind">{kind}</span>
      <span className="lib-status">{status}</span>
      <span className="lib-actions">{actions}</span>
    </li>
  );
  const deeper = { ...tree, depth: tree.depth + 1 };
  return (
    <>
      {row}
      {open &&
        node.children.map((child) => (
          <NodeView
            key={child.kind === "map" ? mapKey(child.map) : jobKey(child.job)}
            node={child}
            tree={deeper}
          />
        ))}
    </>
  );
}
function jobStatus(job: GenerationStatus): ReactNode {
  if (job.state === "completed") return "generation complete";
  const progress = job.progress === null ? "" : ` ${Math.round(job.progress * 100)}%`;
  return (
    <>
      {job.state}
      {progress} · {job.step}
      {job.recovery?.checkpoint && <em> · Resume from: {job.recovery.checkpoint}</em>}
      {job.recovery?.problem && <em role="status"> · {job.recovery.problem}</em>}
    </>
  );
}
function MapStatus({ node }: { node: MapNode }) {
  const { map, job } = node;
  const parts = [
    !map.complete && "incomplete",
    job ? jobStatus(job) : map.complete && "complete",
    map.saved && "saved view",
  ].filter(Boolean);
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 && " · "}
          {part}
        </span>
      ))}
      {map.problem && (
        <strong className="lib-warning" title={map.problem} role="status">
          {" "}
          · cannot open
        </strong>
      )}
    </>
  );
}
function MapRow({ node, tree }: { node: MapNode; tree: TreeState }) {
  const { map, job } = node;
  const { library } = tree;
  const remove = (target: DeleteContext, name: string) => library.confirmDelete({ target, name });
  return (
    <Row
      node={node}
      tree={tree}
      kind={map.profile}
      name={
        <button
          className="lib-name"
          disabled={!!map.problem || library.opening.isPending || !map.complete}
          onClick={() => library.opening.mutate(map)}
        >
          {map.name}
        </button>
      }
      status={<MapStatus node={node} />}
      actions={
        <>
          {job && <JobActions job={job} tree={tree} map={map} />}
          <DeleteButton
            label={`Delete ${map.name}`}
            ask={() =>
              remove({ kind: "map", id: map.reference.mapId, descendants: false }, map.name)
            }
          />
        </>
      }
    />
  );
}
function JobActions({
  job,
  tree,
  map,
}: {
  job: GenerationStatus;
  tree: TreeState;
  map?: StoredContext;
}) {
  const { library } = tree;
  const stopped = !["running", "completed"].includes(job.state);
  const name = jobName(job);
  return (
    <>
      {stopped && (
        <button
          className="lib-text"
          disabled={!!job.recovery?.problem || library.resume.isPending}
          onClick={() => library.resume.mutate(job)}
        >
          {job.recovery?.checkpoint ? "Resume generation" : "Restart from beginning"}
        </button>
      )}
      {!map && (
        <button className="lib-text" onClick={() => library.props.observe(job)}>
          {job.state === "completed" ? "Open map" : "View"}
        </button>
      )}
      {map && (
        <DeleteButton
          label={`Delete generation record of ${map.name}`}
          disabled={job.state === "running"}
          ask={() => library.confirmDelete({ target: { kind: "job", id: job.jobId }, name })}
        />
      )}
    </>
  );
}
function JobRow({ node, tree }: { node: Extract<LibraryNode, { kind: "job" }>; tree: TreeState }) {
  const { job } = node;
  return (
    <Row
      node={node}
      tree={tree}
      kind="generation"
      name={
        <button className="lib-name" onClick={() => tree.library.props.observe(job)}>
          {jobName(job)}
        </button>
      }
      status={jobStatus(job)}
      actions={
        <>
          <JobActions job={job} tree={tree} />
          <DeleteButton
            label={`Delete job ${jobName(job)}`}
            disabled={job.state === "running"}
            ask={() =>
              tree.library.confirmDelete({
                target: { kind: "job", id: job.jobId },
                name: jobName(job),
              })
            }
          />
        </>
      }
    />
  );
}
export function NodeView({ node, tree }: { node: LibraryNode; tree: TreeState }) {
  return node.kind === "map" ? (
    <MapRow node={node} tree={tree} />
  ) : (
    <JobRow node={node} tree={tree} />
  );
}
/** The confirmation is its own modal, stacked over the library dialog. */
export function DeleteContextPrompt({ state }: { state: LibraryState }) {
  const pending = state.deleting;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (pending && element && !element.open) element.showModal();
    if (!pending && element?.open) element.close();
  }, [pending]);
  const target = pending?.target;
  return (
    <dialog
      ref={dialog}
      className="context-delete"
      role="alertdialog"
      aria-label={pending ? `Delete ${pending.name}` : "Delete"}
      onCancel={(event) => {
        event.preventDefault();
        if (!state.remove.isPending) state.confirmDelete(null);
      }}
    >
      {pending && target && (
        <>
          <h3>Delete {pending.name}?</h3>
          <DeleteExplanation target={target} />
          {target.kind === "map" && (
            <label>
              <input
                type="checkbox"
                checked={target.descendants}
                onChange={(e) =>
                  state.confirmDelete({
                    ...pending,
                    target: { ...target, descendants: e.target.checked },
                  })
                }
              />
              Also delete descendant regions
            </label>
          )}
          <div className="context-actions">
            <button disabled={state.remove.isPending} onClick={() => state.remove.mutate(target)}>
              Delete
            </button>
            <button disabled={state.remove.isPending} onClick={() => state.confirmDelete(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
function DeleteExplanation({ target }: { target: DeleteContext }) {
  if (target.kind === "map")
    return (
      <p>
        Delete this map, its revisions and saved views. Independent children remain accessible
        unless selected below. Shared data needed by surviving maps is retained.
      </p>
    );
  if (target.kind === "job")
    return <p>Delete the job and its recovery data. Its completed map remains available.</p>;
  return <p>Remove this unattached record and data no surviving map or job uses.</p>;
}
