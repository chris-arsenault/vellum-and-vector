import { useState } from "react";
import type { MapFeature } from "@atlas/map";
import { chooseLand, landActive, landBlocked, landTools } from "./realScaleLandActions";
import { kindSize, lineSizes, type LandChoice } from "./realScaleLandTools";
import type { AuthoringSession } from "./useRealScaleAuthoring";

/** Tools for building on the land: water, ways, objects, scatters, cave walls and hexes. */
export function LandToolBar({ session }: { session: AuthoringSession }) {
  return (
    <div role="toolbar" aria-label="Land tools">
      {landTools.map((land) => {
        const blocked = landBlocked(session, land);
        return (
          <button
            key={land.id}
            aria-pressed={landActive(session, land)}
            disabled={!!blocked}
            title={blocked ?? `${land.name} (${land.shortcut})`}
            onClick={() => chooseLand(session, land)}
          >
            {land.name}
          </button>
        );
      })}
    </div>
  );
}
/** The choices of the land tool in hand. */
export function LandOptions({ session }: { session: AuthoringSession }) {
  const { tool } = session.state;
  if (tool === "draw") return <LineSize session={session} />;
  if (tool === "place" || tool === "scatter") return <ObjectOptions session={session} />;
  if (tool === "hexes")
    return <p>Click a hex, Shift-click to add one, or drag a box around several.</p>;
  return null;
}
/** Starting width from the drawn kind's published true size; each point's width is edited
 * after drawing. */
function LineSize({ session }: { session: AuthoringSession }) {
  const choice = session.state.draw;
  const sizes = choice ? lineSizes(kindSize(session.map, choice.layerId, choice.kind)) : [];
  if (!choice || !sizes.length) return null;
  const chosen = sizes.findIndex((size) => size.width === choice.width);
  return (
    <label>
      Size
      <select
        value={chosen}
        onChange={(event) =>
          session.set({ draw: { ...choice, width: sizes[Number(event.target.value)].width } })
        }
      >
        {chosen < 0 && <option value={-1}>{choice.width} m</option>}
        {sizes.map((size, index) => (
          <option key={size.label} value={index}>
            {size.label} ({size.width} m)
          </option>
        ))}
      </select>
    </label>
  );
}
function NumberField(props: {
  label: string;
  value: number;
  min: number;
  step: number;
  set(value: number): void;
}) {
  return (
    <label>
      {props.label}
      <input
        type="number"
        min={props.min}
        step={props.step}
        value={props.value}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (Number.isFinite(value) && value >= props.min) props.set(value);
        }}
      />
    </label>
  );
}
function ObjectOptions({ session }: { session: AuthoringSession }) {
  const { draw: choice, land, tool } = session.state;
  if (!choice) return null;
  const layer = session.map.layers.find((entry) => entry.id === choice.layerId);
  const kinds = layer?.catalog.featureTypes ?? [];
  const setLand = (next: Partial<LandChoice>) => session.set({ land: { ...land, ...next } });
  return (
    <fieldset>
      <legend>{tool === "place" ? "Object" : "Scatter"}</legend>
      <label>
        Object kind
        <select
          value={choice.kind}
          onChange={(event) => session.set({ draw: { ...choice, kind: event.target.value } })}
        >
          {kinds.map((kind) => (
            <option key={kind.id} value={kind.kind}>
              {kind.label}
            </option>
          ))}
        </select>
      </label>
      {tool === "place" ? (
        <>
          <NumberField
            label="Turn (°)"
            value={land.rotation}
            min={-360}
            step={15}
            set={(rotation) => setLand({ rotation })}
          />
          <NumberField
            label="Scale"
            value={land.scale}
            min={0.1}
            step={0.1}
            set={(scale) => setLand({ scale })}
          />
        </>
      ) : (
        <>
          <NumberField
            label="Spacing (m)"
            value={land.spacing}
            min={0.1}
            step={0.1}
            set={(spacing) => setLand({ spacing })}
          />
          <NumberField
            label="Seed"
            value={land.seed}
            min={0}
            step={1}
            set={(seed) => setLand({ seed: Math.round(seed) })}
          />
        </>
      )}
    </fieldset>
  );
}
const wallFeatureNames: Record<string, string> = {
  flowstone: "Flowstone (the rock dissolves)",
  seams: "Mineral seams (Fire's veins)",
  rime: "Rime (Aurora's cold ground)",
};
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
/** A wall's depth below the ground; setting it reads the rock again at that depth. */
function WallDepth({ session, feature }: { session: AuthoringSession; feature: MapFeature }) {
  const own = feature.attributes.depth;
  const cut = feature.attributes.cutDepth;
  const [draft, setDraft] = useState<string | null>(null);
  const shown = typeof own === "number" ? String(own) : "";
  const finish = () => {
    const depth = draft === null || draft.trim() === "" ? null : Number(draft);
    setDraft(null);
    if (draft === null || (depth !== null && !(depth >= 0))) return;
    void session.run({
      command: "setAttributes",
      ids: [feature.id],
      name: null,
      attributes: { depth },
    });
  };
  return (
    <label>
      Depth below ground (m)
      <input
        value={draft ?? shown}
        placeholder={typeof cut === "number" ? `${cut} (nearest cave)` : "first rock bed"}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={finish}
        onKeyDown={(event) => event.key === "Enter" && finish()}
      />
    </label>
  );
}
/** What a cave wall cuts, as it read the published ground when drawn, moved or set deeper. */
export function CaveWallFacts({
  session,
  feature,
}: {
  session: AuthoringSession;
  feature: MapFeature;
}) {
  if (feature.kind !== "caveWall") return null;
  const rock = strings(feature.attributes.rock);
  const features = strings(feature.attributes.wallFeatures);
  return (
    <section aria-label="Cave wall" className="cave-wall-facts">
      <WallDepth session={session} feature={feature} />
      <h4>Cuts through</h4>
      <p>{rock.length ? rock.join(", ") : "No published rock here"}</p>
      <h4>Special features</h4>
      {features.length ? (
        <ul>
          {features.map((name) => (
            <li key={name}>{wallFeatureNames[name] ?? name}</li>
          ))}
        </ul>
      ) : (
        <p>None</p>
      )}
    </section>
  );
}
