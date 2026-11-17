import type { HexClass, JsonValue, MapFeature } from "@atlas/map";
import { coverClasses, groundClasses } from "./realScaleLandTools";
import type { AuthoringSession } from "./useRealScaleAuthoring";

/** The one value every selected hex shares, else "" (mixed). */
function shared(hexes: MapFeature[], key: string) {
  const values = new Set(hexes.map((hex) => hex.attributes[key] ?? null));
  const [only] = values;
  return values.size === 1 && typeof only === "string" ? only : "";
}
function ClassField(props: {
  label: string;
  value: string;
  classes: HexClass[];
  set(value: string): unknown;
}) {
  return (
    <label>
      {props.label}
      <select value={props.value} onChange={(event) => void props.set(event.target.value)}>
        <option value="">(none or mixed)</option>
        {props.classes.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
}
/** Ground and cover of the selected hexes, chosen from the classes the map publishes and set
 * as one undoable edit on the hex features. */
export function RealScaleHexClasses({
  session,
  hexes,
}: {
  session: AuthoringSession;
  hexes: MapFeature[];
}) {
  const set = (key: "ground" | "cover", value: string) => {
    const attributes: Record<string, JsonValue> = { [key]: value || null };
    return session.run({
      command: "setAttributes",
      ids: hexes.map((hex) => hex.id),
      name: null,
      attributes,
    });
  };
  const count = hexes.length === 1 ? "1 hex" : `${hexes.length} hexes`;
  return (
    <section aria-label="Selected hexes" className="real-scale-properties">
      <h3>{count} selected</h3>
      <ClassField
        label="Ground"
        value={shared(hexes, "ground")}
        classes={groundClasses(session.map)}
        set={(value) => set("ground", value)}
      />
      <ClassField
        label="Cover"
        value={shared(hexes, "cover")}
        classes={coverClasses(session.map)}
        set={(value) => set("cover", value)}
      />
    </section>
  );
}
