import { useMutation } from "@tanstack/react-query";
import { analyzeArea, readFeature } from "./atlasReads";
import { ErrorMessage } from "./ErrorMessage";
import { newFeature, type EditorState } from "./useEditor";
import type { World } from "./types";
import type { Geometry } from "geojson";
interface Analysis {
  geometry: Geometry | null;
  measurements: Record<string, number>;
  features: string[];
  areas: string[];
  path: string[];
  notes: string[];
  worldVersion: number;
}
export function AnalysisPanel({ world, editor }: { world: World; editor: EditorState }) {
  const select = useMutation({
    mutationFn: (id: string) => Promise.resolve(readFeature(world.id, id, editor.area.id)),
    onSuccess: (feature) => editor.setSelected(feature),
  });
  const analyze = useMutation({
    mutationFn: (form: FormData) =>
      Promise.resolve(analyzeArea(world.id, analysisInput(editor, form))),
    onSuccess: (result) =>
      editor.setProposedFeatures(
        result.geometry
          ? [newFeature(editor.area, result.geometry, "Analysis", "analysis", "pois")]
          : []
      ),
  });
  return (
    <section>
      <h3>Spatial analysis</h3>
      <p className="hint">
        Use the selected feature or geographic extent. Results do not change the world.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          analyze.mutate(new FormData(event.currentTarget));
        }}
      >
        <AnalysisInputs world={world} editor={editor} />
        <button className="primary" disabled={analyze.isPending}>
          Run analysis
        </button>
      </form>
      <ErrorMessage error={analyze.error ?? select.error} />
      {analyze.data && (
        <AnalysisResults
          data={analyze.data}
          world={world}
          editor={editor}
          select={(id) => select.mutate(id)}
        />
      )}
    </section>
  );
}
function analysisInput(editor: EditorState, form: FormData) {
  return {
    areaId: editor.area.id,
    operation: String(form.get("operation")),
    featureId: editor.selected?.id ?? null,
    geometry: editor.selection ?? analysisGeometry(editor) ?? editor.area.footprint,
    targetFeatureId: String(form.get("target")) || null,
    layer: String(form.get("layer")) || null,
    channel: String(form.get("channel")) || null,
    distance: Number(form.get("distance")),
    networkKind: String(form.get("networkKind")),
  };
}
function analysisGeometry(editor: EditorState) {
  const feature = editor.scene.data?.find((f) => f.id === editor.selected?.id) ?? editor.selected;
  return editor.geometryRole === "footprint" ? feature?.footprint : feature?.geometry;
}
function AnalysisInputs({ world, editor }: { world: World; editor: EditorState }) {
  return (
    <>
      <label>
        Operation
        <select name="operation">
          <option value="measure">Measure geometry</option>
          <option value="buffer">Buffer</option>
          <option value="intersect">Intersect with feature</option>
          <option value="nearby">Nearby features</option>
          <option value="fieldStatistics">Field statistics</option>
          <option value="dependencies">Dependencies and affected areas</option>
          <option value="networkPath">Shortest passable network route</option>
          <option value="circulation">Room / chamber reachability</option>
        </select>
      </label>
      <label>
        Target feature
        <select name="target">
          <option value="">Choose a target</option>
          {editor.scene.data?.map((f) => (
            <option value={f.id} key={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Layer
        <select name="layer">
          <option value="">All layers</option>
          {Object.values(world.layers).map((l) => (
            <option value={l.id} key={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <AnalysisFields world={world} editor={editor} />
      <label>
        Distance · m<input name="distance" type="number" step="any" defaultValue="10" />
      </label>
      <label>
        Network
        <select name="networkKind">
          <option value="road">Roads</option>
          <option value="cave">Cave passages</option>
          <option value="river">Directed rivers</option>
        </select>
      </label>
    </>
  );
}
function AnalysisFields({ world, editor }: { world: World; editor: EditorState }) {
  return (
    <>
      <label>
        Field channel
        <input name="channel" defaultValue={editor.channel} list="analysis-channels" />
      </label>
      <datalist id="analysis-channels">
        {[...new Set(world.fields.flatMap((f) => f.channels ?? []))].map((c) => (
          <option key={c}>{c}</option>
        ))}
      </datalist>
    </>
  );
}
function AnalysisResults({
  data,
  world,
  editor,
  select,
}: {
  data: Analysis;
  world: World;
  editor: EditorState;
  select: (id: string) => void;
}) {
  return (
    <>
      {data.worldVersion !== world.version && (
        <p className="hint">World data changed; run analysis again.</p>
      )}
      <dl>
        {Object.entries(data.measurements).map(([key, value]) => (
          <div key={key}>
            <dt>{key.replaceAll("_", " ")}</dt>
            <dd>{value.toLocaleString(undefined, { maximumFractionDigits: 3 })}</dd>
          </div>
        ))}
      </dl>
      {data.notes.map((note) => (
        <p key={note} className="hint">
          {note}
        </p>
      ))}
      {data.areas.map((id) => (
        <button className="quiet" key={id} onClick={() => editor.enter(id)}>
          {world.areas[id]?.name ?? id}
        </button>
      ))}
      {data.features.map((id) => (
        <button className="quiet" key={id} onClick={() => select(id)}>
          {editor.scene.data?.find((f) => f.id === id)?.name ?? id}
        </button>
      ))}
      <button className="quiet" onClick={() => editor.setProposedFeatures([])}>
        Clear analysis overlay
      </button>
    </>
  );
}
