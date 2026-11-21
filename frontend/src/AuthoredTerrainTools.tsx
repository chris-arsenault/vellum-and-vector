import { useId, type ReactNode } from "react";
import type { Bounds } from "@atlas/map";
import { setBrush, setName, setShape } from "./authoredActions";
import {
  authoredTools,
  formatMetres,
  radiusFromSlider,
  sliderFromRadius,
  type AuthoredTool,
} from "./authoredState";
import { kindEntries } from "./authoredKinds";
import type { AuthoringSession } from "./useRealScaleAuthoring";
import { TownOptions } from "./RealScaleTown";

const steps = 1000;
/** A size on a logarithmic slider, so a small brush has fine steps; the value reads beside it. */
function SizeField(props: {
  label: string;
  value: number;
  bounds: Bounds;
  change(metres: number): void;
}) {
  const id = useId();
  return (
    <div className="authored-field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="range"
        min={0}
        max={steps}
        value={Math.round(sliderFromRadius(props.value, props.bounds) * steps)}
        onChange={(event) =>
          props.change(radiusFromSlider(Number(event.target.value) / steps, props.bounds))
        }
      />
      <output htmlFor={id}>{formatMetres(props.value)}</output>
    </div>
  );
}
function NumberField(props: {
  label: string;
  value: number;
  unit?: string;
  min?: number;
  change(value: number): void;
}) {
  const id = useId();
  return (
    <div className="authored-field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="number"
        value={props.value}
        min={props.min}
        step="any"
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) props.change(next);
        }}
      />
      <span className="authored-unit">{props.unit ?? "m"}</span>
    </div>
  );
}
function Strength({ session }: { session: AuthoringSession }) {
  const id = useId();
  const { strength } = session.state.authored.brush;
  return (
    <div className="authored-field">
      <label htmlFor={id}>Strength</label>
      <input
        id={id}
        type="range"
        min={5}
        max={100}
        value={Math.round(strength * 100)}
        onChange={(event) => setBrush(session, { strength: Number(event.target.value) / 100 })}
      />
      <output htmlFor={id}>{Math.round(strength * 100)}%</output>
    </div>
  );
}
function BrushOptions({ session, tool }: { session: AuthoringSession; tool: AuthoredTool }) {
  const { brush } = session.state.authored;
  const bounds = session.map.bounds;
  return (
    <>
      <SizeField
        label="Radius"
        value={brush.radius}
        bounds={bounds}
        change={(radius) => setBrush(session, { radius })}
      />
      <Strength session={session} />
      {(tool === "raise" || tool === "lower") && (
        <NumberField
          label="Step"
          value={Math.round(brush.stepHeight * 10) / 10}
          min={0}
          change={(stepHeight) => setBrush(session, { stepHeight })}
        />
      )}
      {(tool === "flatten" || tool === "set") && (
        <NumberField
          label="Height"
          value={brush.target}
          change={(target) => setBrush(session, { target })}
        />
      )}
    </>
  );
}
function ShapeOptions({ session, tool }: { session: AuthoringSession; tool: AuthoredTool }) {
  const { shape } = session.state.authored;
  const bounds = session.map.bounds;
  return (
    <>
      <NumberField
        label={tool === "peak" ? "Summit" : "Height"}
        value={shape.height}
        change={(height) => setShape(session, { height })}
      />
      {tool === "heightLine" && (
        <SizeField
          label="Half-width"
          value={shape.halfWidth}
          bounds={bounds}
          change={(halfWidth) => setShape(session, { halfWidth })}
        />
      )}
      {tool === "heightArea" && (
        <SizeField
          label="Feather"
          value={shape.feather}
          bounds={bounds}
          change={(feather) => setShape(session, { feather })}
        />
      )}
      {tool === "peak" && (
        <SizeField
          label="Radius"
          value={shape.peakRadius}
          bounds={bounds}
          change={(peakRadius) => setShape(session, { peakRadius })}
        />
      )}
    </>
  );
}
const guidance: Partial<Record<AuthoredTool, string>> = {
  heightLine:
    "Click each vertex; double-click to finish. A vertex takes the height set when you click it.",
  heightArea: "Click each corner; double-click to finish. The edge fades over the feather.",
  peak: "Click the map to raise a summit.",
  landmass: "Click each corner of the coast; double-click to finish. The land follows its coast.",
  river: "Click along the course; double-click to finish.",
  plot: "Click each corner of the parcel; double-click to finish.",
};
function NameField({ session }: { session: AuthoringSession }) {
  const id = useId();
  const draw = session.state.draw;
  if (!draw) return null;
  return (
    <div className="authored-field authored-name">
      <label htmlFor={id}>Name</label>
      <input
        id={id}
        value={draw.name}
        placeholder="Unnamed"
        onChange={(event) => setName(session, event.target.value)}
      />
    </div>
  );
}
/** The Place tool's armed kind, or the prompt to choose one. */
function Armed({ session }: { session: AuthoringSession }) {
  const armed = kindEntries(session.map).find((entry) => entry.key === session.state.authored.kind);
  if (!armed) return <p className="authored-armed">Pick a kind to place from the list below.</p>;
  return (
    <>
      <p className="authored-armed">
        <strong>{armed.label}</strong> <span>{armed.trail || armed.group}</span>
      </p>
      <NameField session={session} />
    </>
  );
}
function DrawOptions({ session, tool }: { session: AuthoringSession; tool: AuthoredTool }) {
  return tool === "place" ? <Armed session={session} /> : <NameField session={session} />;
}
type Options = (props: { session: AuthoringSession; tool: AuthoredTool }) => ReactNode;
/** What each kind of tool offers; select and edit-points have no options. */
const optionsFor: Partial<Record<AuthoredTool, Options>> = {
  raise: BrushOptions,
  lower: BrushOptions,
  smooth: BrushOptions,
  flatten: BrushOptions,
  set: BrushOptions,
  heightLine: ShapeOptions,
  heightArea: ShapeOptions,
  peak: ShapeOptions,
  landmass: DrawOptions,
  river: DrawOptions,
  plot: DrawOptions,
  place: DrawOptions,
  // The town vocabulary of the real-scale editor: street class, building use and name.
  street: ({ session }) => <TownOptions session={session} />,
  building: ({ session }) => <TownOptions session={session} />,
};
/** The options of the tool in hand: brush size and strength, height shapes, a name, or the
 * town class and use. Select and Edit points show their hint, so the row keeps its height. */
export function AuthoredToolOptions({ session }: { session: AuthoringSession }) {
  const tool = session.state.authored.tool;
  const Tool = optionsFor[tool];
  const hint = authoredTools.find((entry) => entry.id === tool)?.hint;
  return (
    <section className="authored-options" aria-label="Tool options">
      {Tool ? <Tool session={session} tool={tool} /> : <p className="authored-guidance">{hint}</p>}
      {guidance[tool] && <p className="authored-guidance">{guidance[tool]}</p>}
    </section>
  );
}
