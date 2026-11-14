import { useState } from "react";
import {
  paletteTools,
  drawingDefinition,
  toolInstruction,
  toolLabel,
  workspaces,
} from "./cartography";
import type { EditorState } from "./useEditor";
import type { World } from "./types";
import { AttributeEditor } from "./AttributeEditor";
import { makeCommand } from "./useAtlas";
import { FieldBrush } from "./FieldBrush";

export function CartographyPanel({ world, editor }: { world: World; editor: EditorState }) {
  if (editor.templateToPlace)
    return (
      <section>
        <h2>Place {editor.templateToPlace.name}</h2>
        <p>Click its position in {editor.area.name}. Press Escape to cancel.</p>
        <button onClick={editor.cancel}>Cancel placement</button>
      </section>
    );
  return (
    <section>
      <p className="eyebrow">{editor.area.name}</p>
      <h2>{workspaces[editor.workspace]}</h2>
      <p>{toolInstruction(editor.tool)}</p>
      <LayerContext world={world} editor={editor} />
      <div role="group" aria-label="Layer authoring tools">
        {paletteTools(editor.workspace, world.layers[editor.customLayer]).map((tool) => (
          <button
            className="secondary"
            key={tool}
            aria-pressed={tool === editor.tool}
            onClick={() => editor.setTool(tool)}
          >
            {toolLabel(tool)}
          </button>
        ))}
      </div>
      <DrawingProperties world={world} editor={editor} />
      {editor.workspace === "terrain" && <FieldBrush world={world} editor={editor} />}
      <p className="hint">
        Click to place points. Trace lines and outlines, then double-click to finish. Select a
        feature to move, reshape or develop it. Hold Space to pan.
      </p>
    </section>
  );
}
function LayerContext({ world, editor }: { world: World; editor: EditorState }) {
  switch (editor.workspace) {
    case "politics":
      return <PolityChoice world={world} editor={editor} />;
    case "cultures":
      return <CulturalFields world={world} editor={editor} />;
    case "custom":
      return (
        <>
          <label>
            Custom layer
            <select
              aria-label="Custom layer"
              value={editor.customLayer}
              onChange={(event) => {
                editor.setCustomLayer(event.target.value);
                editor.setChannel(event.target.value);
              }}
            >
              <option value="">Choose a layer</option>
              {Object.values(world.layers)
                .filter((layer) => layer.family === "custom")
                .map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layer.name}
                  </option>
                ))}
            </select>
          </label>
          {editor.customLayer && <FieldBrush world={world} editor={editor} />}
          <button className="quiet" onClick={() => editor.setPanel("more")}>
            Define a custom layer in the library
          </button>
        </>
      );
    default:
      return null;
  }
}
function DrawingProperties({ world, editor }: { world: World; editor: EditorState }) {
  const drawing = drawingDefinition(editor.tool, editor.customLayer, world);
  if (!drawing) return null;
  const schema = world.layers[drawing.layer]?.schema ?? {};
  return (
    <>
      <label>
        Name <small>optional; you can rename after placement</small>
        <input
          aria-label="Feature name"
          value={editor.drawName}
          onChange={(event) => editor.setDrawName(event.target.value)}
          placeholder={drawing.kind}
        />
      </label>
      {Object.keys(schema).length > 0 && (
        <AttributeEditor
          schema={schema}
          values={editor.drawAttributes}
          change={editor.setDrawAttributes}
        />
      )}
      {editor.tool === "hill" && (
        <label>
          Landform height · m
          <input
            type="number"
            step="any"
            value={Number(editor.drawAttributes.height ?? 100)}
            onChange={(event) =>
              editor.setDrawAttributes({
                ...editor.drawAttributes,
                height: Number(event.target.value),
              })
            }
          />
        </label>
      )}
    </>
  );
}
function PolityChoice({ world, editor }: { world: World; editor: EditorState }) {
  const [name, setName] = useState("");
  return (
    <fieldset>
      <legend>Whose boundary?</legend>
      <label>
        Polity
        <select
          aria-label="Polity"
          value={editor.entityId}
          onChange={(event) => editor.setEntityId(event.target.value)}
        >
          <option value="">Choose a polity</option>
          {Object.values(world.entities)
            .filter((entity) => entity.kind === "polity")
            .map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        New polity name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button
        type="button"
        disabled={!name.trim() || editor.commit.isPending}
        onClick={() => {
          const id = crypto.randomUUID();
          editor.commit.mutate(
            makeCommand(world, "putEntity", {
              id,
              name,
              kind: "polity",
              attributes: {},
              relations: [],
            }),
            {
              onSuccess: () => {
                editor.setEntityId(id);
                setName("");
              },
            }
          );
        }}
      >
        Name a polity
      </button>
      <p className="hint">
        Draw territory, claims and effective control separately. Overlapping claims remain separate
        facts.
      </p>
    </fieldset>
  );
}
function CulturalFields({ world, editor }: { world: World; editor: EditorState }) {
  const entities = Object.values(world.entities).filter((entity) =>
    ["culture", "language", "religion"].includes(entity.kind)
  );
  return (
    <section>
      <h3>Paint a distribution</h3>
      <p>
        Place an origin to establish a group, then paint its presence. Distributions can overlap.
      </p>
      <label>
        Community
        <select
          aria-label="Community"
          value={editor.entityId}
          onChange={(event) => {
            const id = event.target.value;
            editor.setEntityId(id);
            const entity = world.entities[id];
            if (entity) {
              editor.setChannel(`${entity.kind}:${id}`);
              editor.setBrush({ ...editor.brush, mode: "set", delta: 1 });
            }
          }}
        >
          <option value="">Choose a community</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name} · {entity.kind}
            </option>
          ))}
        </select>
      </label>
      {entities.some((entity) => entity.id === editor.entityId) && (
        <FieldBrush world={world} editor={editor} />
      )}
    </section>
  );
}
