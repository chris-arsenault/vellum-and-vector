import { useRef, useState } from "react";
import type { MapReader } from "@atlas/map";
import type { AuthoringSession } from "./useRealScaleAuthoring";
import { buildingUses, streetClasses, type TownChoice } from "./realScaleTown";
import { addressFieldId, townBlocked, townTools } from "./realScaleTownActions";

/** Draw a street, place a building. */
export function TownToolBar({ session }: { session: AuthoringSession }) {
  return (
    <div role="toolbar" aria-label="Town tools">
      {townTools.map((town) => {
        const blocked = townBlocked(session, town);
        return (
          <button
            key={town.id}
            aria-pressed={session.state.tool === town.tool}
            disabled={!!blocked}
            title={blocked ?? `${town.name} (${town.shortcut})`}
            onClick={() => session.set({ tool: town.tool })}
          >
            {town.name}
          </button>
        );
      })}
    </div>
  );
}
/** The street class or building use of the town tool in hand, and an optional name. */
export function TownOptions({ session }: { session: AuthoringSession }) {
  const { tool, town } = session.state;
  if (tool !== "street" && tool !== "building") return null;
  const change = (next: Partial<TownChoice>) => session.set({ town: { ...town, ...next } });
  const street = tool === "street";
  return (
    <fieldset>
      <legend>{street ? "New street" : "New building"}</legend>
      <label>
        {street ? "Street class" : "Use"}
        <select
          value={street ? town.roadClass : town.use}
          onChange={(event) =>
            change(street ? { roadClass: event.target.value } : { use: event.target.value })
          }
        >
          {(street ? streetClasses : buildingUses).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {street ? "Street name" : "Keeper"}
        <input
          value={town.name}
          placeholder="Named by the settlement"
          onChange={(event) => change({ name: event.target.value })}
        />
      </label>
      <p>
        {street
          ? "Start or end on a street to join it."
          : "Click beside a street, or inside an empty plot."}
      </p>
    </fieldset>
  );
}
/** Find a building by its address, or a street by its name, and centre the map on it. */
export function AddressSearch({
  session,
  reader,
}: {
  session: AuthoringSession;
  reader: MapReader;
}) {
  const [text, setText] = useState("");
  const [found, setFound] = useState("");
  const serial = useRef(0);
  const find = async () => {
    try {
      const matches = await reader.findAddress(session.map.reference, text);
      const [first] = matches;
      if (!first) return setFound(`Nothing found at ${text.trim()}`);
      serial.current += 1;
      session.set({
        tool: "select",
        selected: [first.featureId],
        focus: { bounds: first.bounds, serial: serial.current },
      });
      const more = matches.length > 1 ? ` and ${matches.length - 1} more` : "";
      setFound(`${first.address}${more}`);
    } catch (failure) {
      setFound(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <section aria-label="Address search">
      <label>
        Find address
        <input
          id={addressFieldId}
          value={text}
          placeholder="12 Mill Lane"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void find();
          }}
        />
      </label>
      <button onClick={() => void find()} disabled={!text.trim()}>
        Find
      </button>
      <output aria-label="Address found">{found}</output>
    </section>
  );
}
