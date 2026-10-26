import { useState } from "react";
import { landmarkKind, landmarkKinds, type Landmark, type LandmarkKind } from "@atlas/domain";
import type { Geometry } from "geojson";
import { makeCommand } from "./useAtlas";
import { ErrorMessage } from "./ErrorMessage";
import type { EditorState } from "./useEditor";
import { landmarkFeatures } from "./magicFeatures";

/**
 * The landmarks the generator sited in this world. A creator renames one, adjusts the measures
 * it is held to, moves it or removes it; the next physical run keeps every record it finds and
 * sites only what the configured count still lacks.
 */
export function LandmarkForm({ editor }: { editor: EditorState }) {
  const draft = editor.landmarkDraft;
  const landmark = editor.world.landmarks.find((l) => l.id === draft?.id);
  return (
    <section>
      <h2>Landmarks in this landscape</h2>
      <p>
        Major landmarks are sited by the generator during the physical epochs and held to their
        measures through every later epoch. Set how many a world gets under the generator&apos;s
        advanced settings; edit the result here.
      </p>
      {draft && landmark ? (
        <LandmarkSettings key={landmark.id} editor={editor} draft={draft} landmark={landmark} />
      ) : null}
      <LandmarkList editor={editor} />
      <p className="hint">
        Saving changes the landmark record. Regenerate the physical domain to re-form it; drainage,
        climate and ice respond in the same generation.
      </p>
      <ErrorMessage error={editor.commit.error} />
    </section>
  );
}
function LandmarkList({ editor }: { editor: EditorState }) {
  const landmarks = editor.world.landmarks;
  return (
    <section>
      <h3>Landmarks</h3>
      {!landmarks.length && (
        <p className="hint">
          None yet. Generate the physical domain; the generator sites the configured number.
        </p>
      )}
      {landmarks.map((landmark) => (
        <div key={landmark.id}>
          <strong>{landmark.name || landmarkKind(landmark.kind)?.label}</strong>
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
function LandmarkSettings({
  editor,
  draft,
  landmark,
}: {
  editor: EditorState;
  draft: { id: string; geometry: Geometry };
  landmark: Landmark;
}) {
  const choices = landmarkKinds.filter((kind) => kind.geometry === draft.geometry.type);
  const [kindId, setKindId] = useState(landmark.kind);
  const kind = landmarkKind(kindId);
  const [parameters, setParameters] = useState<Record<string, number>>(landmark.parameters);
  const chooseKind = (id: string) => {
    setKindId(id);
    const next = landmarkKind(id);
    setParameters(
      id === landmark.kind
        ? landmark.parameters
        : Object.fromEntries((next?.parameters ?? []).map((p) => [p.key, p.default]))
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
      <h3>Edit {landmark.name || kind.label}</h3>
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
      <MoveLandmark editor={editor} landmark={landmark} />
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
  landmark: Landmark;
  kind: LandmarkKind;
  kindId: string;
  choices: LandmarkKind[];
  chooseKind(id: string): void;
}) {
  return (
    <>
      <label>
        Landmark name
        <input name="name" defaultValue={landmark.name || kind.label} required />
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
        <select name="emplacedAtEpoch" defaultValue={landmark.emplacedAtEpoch}>
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
function saveLandmark(
  editor: EditorState,
  draft: { id: string; geometry: Geometry },
  landmark: Landmark,
  kind: string,
  parameters: Record<string, number>,
  form: FormData
) {
  editor.commit.mutate(
    makeCommand(editor.world, "putLandmark", {
      id: landmark.id,
      areaId: landmark.areaId ?? editor.area.id,
      name: String(form.get("name")),
      kind,
      geometry: draft.geometry,
      parameters,
      emplacedAtEpoch: Number(form.get("emplacedAtEpoch")),
      origin: landmark.origin,
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
