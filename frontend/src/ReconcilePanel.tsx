import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import GeoJSON from "ol/format/GeoJSON.js";
import { previewWorkspaceCommand } from "./workspaceAuthoring";
import { useConnections } from "./useWorkspacePresentation";
import { ErrorMessage } from "./ErrorMessage";
import { AttributeEditor } from "./AttributeEditor";
import { makeCommand } from "./useAtlas";
import type { Command, Connection, Proposal, World } from "./types";
import type { EditorState } from "./useEditor";

export function ReconcilePanel({ world, editor }: { world: World; editor: EditorState }) {
  const [command, setCommand] = useState<Command | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const preview = useMutation({
    mutationFn: async (input: Command) => previewWorkspaceCommand(world.id, input),
    onSuccess: (result) => editor.setProposedFeatures(Object.values(result.candidate.features)),
  });
  function inspect() {
    const data = reconcileInput(editor, connections);
    if (!data) return;
    const input = makeCommand(world, "reconcileBoundary", data);
    setCommand(input);
    preview.mutate(input);
  }
  function clear() {
    editor.setPendingEdits([]);
    editor.setPendingSculpt(null);
    editor.setReconciling(false);
    editor.setProposedFeatures([]);
    editor.setPanel("inspect");
  }
  return (
    <section>
      <h2>Reconcile connected geography</h2>
      <p className="hint">
        The ordinary edit met a fixed interface. Stage the connected changes, inspect their impact,
        then reconcile them together.
      </p>
      <StagedEdits world={world} editor={editor} reset={() => preview.reset()} />
      <button
        className="secondary"
        onClick={() => {
          editor.setReconciling(true);
          editor.setTool("reshape");
          editor.setPanel("inspect");
        }}
      >
        Include another feature reshape
      </button>
      <ConnectionChanges
        world={world}
        editor={editor}
        update={(updated) => {
          setConnections([...connections.filter((c) => c.id !== updated.id), updated]);
          preview.reset();
        }}
      />
      <button
        className="primary"
        onClick={inspect}
        disabled={preview.isPending || (!editor.pendingEdits.length && !editor.pendingSculpt)}
      >
        Preview affected geography
      </button>
      <ErrorMessage error={preview.error ?? editor.commit.error} />
      {preview.data && command && (
        <ReconcileImpact
          key={preview.data.candidate.version + ":" + preview.submittedAt}
          proposal={preview.data}
          command={command}
          world={world}
          editor={editor}
          clear={clear}
        />
      )}
      <button className="quiet" onClick={clear}>
        Discard staged changes
      </button>
    </section>
  );
}
function reconcileInput(editor: EditorState, connections: Connection[]) {
  if (editor.pendingSculpt) return { sculpt: editor.pendingSculpt };
  const first = editor.pendingEdits[0];
  if (!first) return null;
  return {
    featureId: first.feature.id,
    areaId: first.areaId,
    geometry: first.feature.geometry,
    attributes: first.feature.attributes,
    changes: editor.pendingEdits.slice(1),
    connections,
  };
}
function StagedEdits({
  world,
  editor,
  reset,
}: {
  world: World;
  editor: EditorState;
  reset: () => void;
}) {
  return (
    <>
      {editor.pendingSculpt && (
        <p>
          Field change: {String(editor.pendingSculpt.channel)} · radius{" "}
          {String(editor.pendingSculpt.radius)} m · change {String(editor.pendingSculpt.delta)}
        </p>
      )}
      {editor.pendingEdits.map((edit, index) => (
        <details key={edit.feature.id}>
          <summary>{edit.feature.name}</summary>
          <AttributeEditor
            values={edit.feature.attributes}
            schema={world.layers[edit.feature.layerId].schema}
            change={(attributes) => {
              editor.setPendingEdits(
                editor.pendingEdits.map((e, i) =>
                  i === index ? { ...e, feature: { ...e.feature, attributes } } : e
                )
              );
              reset();
            }}
          />
        </details>
      ))}
    </>
  );
}
function ConnectionChanges({
  world,
  editor,
  update,
}: {
  world: World;
  editor: EditorState;
  update: (connection: Connection) => void;
}) {
  const connections = useConnections(world, editor.area.id);
  const attached = (connections.data ?? []).filter((c) =>
    editor.pendingEdits.some(
      (e) => e.feature.id === c.a.featureId || e.feature.id === c.b.featureId
    )
  );
  return (
    <>
      {attached.map((connection) => (
        <div key={connection.id}>
          <p>
            {connection.kind}: {world.areas[connection.a.areaId]?.name} →{" "}
            {world.areas[connection.b.areaId]?.name}
          </p>
          <button className="quiet" onClick={() => update(reattach(connection, editor))}>
            Reattach to the staged geometry
          </button>
        </div>
      ))}
    </>
  );
}
function reattach(connection: Connection, editor: EditorState) {
  const updated = structuredClone(connection);
  for (const end of [updated.a, updated.b]) {
    const edit = editor.pendingEdits.find((e) => e.feature.id === end.featureId);
    if (!edit) continue;
    const geometry = new GeoJSON().readGeometry(edit.feature.geometry);
    if (!geometry) continue;
    const point = geometry.getClosestPoint([end.position.x, end.position.y]);
    end.position = { ...end.position, x: point[0], y: point[1] };
  }
  return updated;
}
function ReconcileImpact({
  proposal,
  command,
  world,
  editor,
  clear,
}: {
  proposal: Proposal;
  command: Command;
  world: World;
  editor: EditorState;
  clear: () => void;
}) {
  const [confirmed, confirm] = useState(false);
  const impact = proposal.impact;
  function commit() {
    editor.commit.mutate(
      {
        ...command,
        data: {
          ...command.data,
          confirm: true,
          areaVersions: Object.fromEntries(impact.areas.map((id) => [id, world.areas[id].version])),
        },
      },
      { onSuccess: clear }
    );
  }
  return (
    <div className="callout">
      <h3>Affected geography</h3>
      <p>
        {impact.features.length} features · {impact.areas.length} mapped areas
      </p>
      {impact.areas.map((id) => (
        <p key={id}>{world.areas[id]?.name ?? id}</p>
      ))}
      {impact.invalidations.map((item, i) => (
        <p key={i}>{item}</p>
      ))}
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(e) => confirm(e.target.checked)} />
        Reconcile these boundaries and dependent facts
      </label>
      <button
        className="primary"
        disabled={
          !confirmed || command.expectedVersion !== world.version || editor.commit.isPending
        }
        onClick={commit}
      >
        Commit reconciliation
      </button>
      {command.expectedVersion !== world.version && <p>World data changed; preview again.</p>}
    </div>
  );
}
