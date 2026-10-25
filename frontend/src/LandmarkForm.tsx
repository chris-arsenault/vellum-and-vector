import { useState } from "react";
import {
  defaultLandmarkParameters,
  landmarkKind,
  landmarkKinds,
  type Landmark,
  type LandmarkKind,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { makeCommand } from "./useAtlas";
import { ErrorMessage } from "./ErrorMessage";
import type { EditorState } from "./useEditor";
import { landmarkFeatures } from "./magicFeatures";

export function LandmarkForm({ editor }: { editor: EditorState }) {
  const draft = editor.landmarkDraft;
  const landmark = editor.world.landmarks.find((l) => l.id === draft?.id);
  return (
    <section>
      <h2>Landmarks in this landscape</h2>
      <p>
        A landmark forms at a chosen epoch from injected causes; its defining measures are held
        through every later epoch while the surroundings respond.
      </p>
      <div role="group" aria-label="Landmark placement">
        <button className="primary" onClick={() => editor.setTool("landmark")}>
          Place landmark
        </button>
        <button className="secondary" onClick={() => editor.setTool("landmarkPath")}>
          Draw landmark path
        </button>
      </div>
      {draft ? (
        <LandmarkSettings
          key={`${landmark?.id ?? "new"}:${draft.geometry.type}`}
          editor={editor}
          draft={draft}
          landmark={landmark}
        />
      ) : (
        <p>
          Click a point for a mountain, ring structure or falls; trace a path for a canyon or
          escarpment. Select an existing landmark to edit or move it.
        </p>
      )}
      <LandmarkList editor={editor} />
      <p className="hint">
        Saving changes the landmark record. Regenerate the physical domain to form it; drainage,
        climate and ice respond in the same generation.
      </p>
      <ErrorMessage error={editor.commit.error} />
    </section>
  );
}
function LandmarkList({ editor }: { editor: EditorState }) {
  return (
    <section>
      <h3>Placed landmarks</h3>
      {editor.world.landmarks.map((landmark) => (
        <div key={landmark.id}>
          <strong>{landmark.name}</strong>
          <small>{describeLandmark(editor, landmark)}</small>
          <button
            className="quiet"
            onClick={() => {
              editor.setLandmarkDraft({ id: landmark.id, geometry: landmark.geometry });
              editor.setTool("select");
            }}
          >
            Edit landmark
          </button>
          <button
            className="quiet"
            onClick={() => editor.execute("removeLandmark", { id: landmark.id })}
          >
            Remove landmark
          </button>
        </div>
      ))}
    </section>
  );
}
/** Kind, guaranteed measures in their units, and the forming epoch for a listing line. */
function describeLandmark(editor: EditorState, landmark: Landmark) {
  const kind = landmarkKind(landmark.kind);
  const epoch = editor.world.epochs[landmark.emplacedAtEpoch];
  return [
    kind?.label ?? landmark.kind,
    ...(kind ? [signature(kind, landmark.parameters)] : []),
    `forms in ${epoch?.id ?? `epoch ${landmark.emplacedAtEpoch}`}`,
  ].join(" · ");
}
function signature(kind: LandmarkKind, parameters: Record<string, number>) {
  return kind.parameters
    .filter((p) => !p.advisory)
    .map((p) => `${p.label.toLowerCase()} ${parameters[p.key]} ${p.unit}`)
    .join(", ");
}
function initialKind(landmark: Landmark | undefined, choices: LandmarkKind[]) {
  if (landmark) return landmark.kind;
  return choices.length ? choices[0].id : "";
}
function LandmarkSettings({
  editor,
  draft,
  landmark,
}: {
  editor: EditorState;
  draft: { id: string | null; geometry: Geometry };
  landmark: Landmark | undefined;
}) {
  const choices = landmarkKinds.filter((kind) => kind.geometry === draft.geometry.type);
  const [kindId, setKindId] = useState(() => initialKind(landmark, choices));
  const kind = landmarkKind(kindId);
  const [parameters, setParameters] = useState<Record<string, number>>(() =>
    initialParameters(landmark, kind)
  );
  const chooseKind = (id: string) => {
    setKindId(id);
    setParameters(
      initialParameters(landmark?.kind === id ? landmark : undefined, landmarkKind(id))
    );
  };
  if (!kind) return <p>No landmark kind is drawn with a {draft.geometry.type.toLowerCase()}.</p>;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        saveLandmark(
          editor,
          draft,
          landmark,
          kindId,
          parameters,
          new FormData(event.currentTarget)
        );
      }}
    >
      <h3>{landmark ? `Edit ${landmark.name}` : "Configure this landmark"}</h3>
      <LandmarkIdentity
        editor={editor}
        landmark={landmark}
        kind={kind}
        kindId={kindId}
        choices={choices}
        chooseKind={chooseKind}
      />
      <MeasureFields kind={kind} parameters={parameters} change={setParameters} />
      <button className="primary" disabled={editor.commit.isPending}>
        Save landmark
      </button>
      {landmark && <MoveLandmark editor={editor} landmark={landmark} />}
      <button type="button" className="quiet" onClick={() => editor.setLandmarkDraft(null)}>
        Cancel landmark editing
      </button>
    </form>
  );
}
function LandmarkIdentity({
  editor,
  landmark,
  kind,
  kindId,
  choices,
  chooseKind,
}: {
  editor: EditorState;
  landmark: Landmark | undefined;
  kind: LandmarkKind;
  kindId: string;
  choices: LandmarkKind[];
  chooseKind(id: string): void;
}) {
  return (
    <>
      <label>
        Landmark name
        <input name="name" defaultValue={landmark?.name ?? kind.label} required />
      </label>
      <label>
        Landmark kind
        <select name="kind" value={kindId} onChange={(event) => chooseKind(event.target.value)}>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.group} · {choice.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">{kind.description}</p>
      <label>
        Forms in
        <select name="emplacedAtEpoch" defaultValue={landmark?.emplacedAtEpoch ?? 0}>
          {editor.world.epochs.map((epoch, index) => (
            <option key={epoch.id} value={index}>
              {epoch.id}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
function initialParameters(landmark: Landmark | undefined, kind: LandmarkKind | undefined) {
  if (landmark) return landmark.parameters;
  return kind ? defaultLandmarkParameters(kind) : {};
}
function saveLandmark(
  editor: EditorState,
  draft: { id: string | null; geometry: Geometry },
  landmark: Landmark | undefined,
  kind: string,
  parameters: Record<string, number>,
  form: FormData
) {
  editor.commit.mutate(
    makeCommand(editor.world, "putLandmark", {
      id: landmark?.id ?? crypto.randomUUID(),
      areaId: landmark?.areaId ?? editor.area.id,
      name: String(form.get("name")),
      kind,
      geometry: draft.geometry,
      parameters,
      emplacedAtEpoch: Number(form.get("emplacedAtEpoch")),
    }),
    { onSuccess: () => editor.setLandmarkDraft(null) }
  );
}
function MeasureFields({
  kind,
  parameters,
  change,
}: {
  kind: LandmarkKind;
  parameters: Record<string, number>;
  change(parameters: Record<string, number>): void;
}) {
  return (
    <>
      {kind.parameters.map((parameter) => (
        <label key={parameter.key}>
          {parameter.label} · {parameter.unit}
          {parameter.advisory ? " (advisory)" : ""}
          <input
            name={parameter.key}
            type="number"
            min={parameter.min}
            max={parameter.max}
            step="any"
            value={parameters[parameter.key] ?? parameter.default}
            onChange={(event) =>
              change({ ...parameters, [parameter.key]: Number(event.target.value) })
            }
            required
          />
        </label>
      ))}
    </>
  );
}
function MoveLandmark({ editor, landmark }: { editor: EditorState; landmark: Landmark }) {
  const isPoint = landmark.geometry.type === "Point";
  return (
    <button
      type="button"
      className="secondary"
      onClick={() => {
        editor.setSelected(
          landmarkFeatures(editor.world, editor.area.id, editor.area.footprint).find(
            (feature) => feature.id === landmark.id
          ) ?? null
        );
        editor.setTool(isPoint ? "move" : "reshape");
      }}
    >
      {isPoint ? "Move landmark on map" : "Reshape path on map"}
    </button>
  );
}
