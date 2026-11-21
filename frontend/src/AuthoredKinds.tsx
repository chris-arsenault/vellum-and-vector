import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./AuthoredIcons";
import { armKind } from "./authoredActions";
import {
  groupKinds,
  kindEntries,
  pushRecent,
  resolveKeys,
  searchKinds,
  toggleFavourite,
  type KindEntry,
} from "./authoredKinds";
import type { AuthoringSession } from "./useRealScaleAuthoring";

const storageKey = "atlas.authored.kinds";
interface Memory {
  recents: string[];
  favourites: string[];
}
/** Recent and favourite kinds are a per-browser convenience; the page works without them. */
function loadMemory(): Memory {
  try {
    const held = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Partial<Memory>;
    return { recents: held.recents ?? [], favourites: held.favourites ?? [] };
  } catch {
    return { recents: [], favourites: [] };
  }
}
function useKindMemory() {
  const [memory, setMemory] = useState(loadMemory);
  const update = (next: Memory) => {
    setMemory(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Storage can be blocked; the lists then last for this visit only.
    }
  };
  return {
    ...memory,
    remember: (key: string) => update({ ...memory, recents: pushRecent(memory.recents, key) }),
    favourite: (key: string) =>
      update({ ...memory, favourites: toggleFavourite(memory.favourites, key) }),
  };
}
const geometryName = { Point: "point", LineString: "line", Polygon: "area" } as const;

interface RowProps {
  entry: KindEntry;
  armed: boolean;
  starred: boolean;
  pick(entry: KindEntry): void;
  star(entry: KindEntry): void;
}
function KindRow({ entry, armed, starred, pick, star }: RowProps) {
  return (
    <li className="authored-kind" data-armed={armed}>
      <button
        type="button"
        className="authored-kind-pick"
        aria-pressed={armed}
        title={`${entry.label}, drawn as ${geometryName[entry.geometry]}`}
        onClick={() => pick(entry)}
      >
        <span className="authored-badge" aria-label={geometryName[entry.geometry]}>
          <Icon name={entry.geometry} size={14} />
        </span>
        <span className="authored-kind-text">
          <span>{entry.label}</span>
          {entry.trail && <small>{entry.trail}</small>}
        </span>
      </button>
      <button
        type="button"
        className="authored-star"
        aria-pressed={starred}
        aria-label={`${starred ? "Remove" : "Add"} ${entry.label} ${starred ? "from" : "to"} favourites`}
        onClick={() => star(entry)}
      >
        <Icon name={starred ? "starFilled" : "star"} size={14} />
      </button>
    </li>
  );
}
function Chips({
  title,
  list,
  pick,
}: {
  title: string;
  list: KindEntry[];
  pick(e: KindEntry): void;
}) {
  if (!list.length) return null;
  return (
    <div className="authored-chips" role="group" aria-label={title}>
      <span className="authored-group-name">{title}</span>
      <div>
        {list.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="authored-chip"
            onClick={() => pick(entry)}
          >
            <Icon name={entry.geometry} size={12} />
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}
/** Arrow keys walk the kind buttons; Down from the search field enters the list. */
function walk(event: KeyboardEvent, root: HTMLElement) {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  const picks = [...root.querySelectorAll<HTMLButtonElement>(".authored-kind-pick")].filter(
    (button) => button.offsetParent !== null || button === document.activeElement
  );
  if (!picks.length) return;
  const at = picks.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "ArrowDown" ? at + 1 : at - 1;
  event.preventDefault();
  picks[Math.min(Math.max(next, 0), picks.length - 1)].focus();
}
/** Every kind of the map's catalogue, searchable and grouped by category; choosing one arms
 * the Place tool. The list comes from the catalogue alone. */
export function AuthoredKinds({ session }: { session: AuthoringSession }) {
  const entries = useMemo(() => kindEntries(session.map), [session.map]);
  const memory = useKindMemory();
  const [query, setQuery] = useState("");
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const key = (event: KeyboardEvent) => walk(event, element);
    element.addEventListener("keydown", key);
    return () => element.removeEventListener("keydown", key);
  }, []);
  const armedKey = session.state.authored.kind;
  const found = useMemo(() => searchKinds(entries, query), [entries, query]);
  const pick = (entry: KindEntry) => {
    memory.remember(entry.key);
    armKind(session, entry);
  };
  const rowFor = (entry: KindEntry) => (
    <KindRow
      key={entry.key}
      entry={entry}
      armed={armedKey === entry.key}
      starred={memory.favourites.includes(entry.key)}
      pick={pick}
      star={(item) => memory.favourite(item.key)}
    />
  );
  return (
    <section ref={root} className="authored-kinds" aria-label="Kinds to place">
      <h3>Places</h3>
      <div className="authored-search">
        <Icon name="search" size={15} />
        <input
          type="search"
          value={query}
          placeholder={`Search ${entries.length} kinds`}
          aria-label="Search kinds"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !query) return;
            event.stopPropagation();
            setQuery("");
          }}
        />
      </div>
      {!query && (
        <>
          <Chips title="Favourites" list={resolveKeys(memory.favourites, entries)} pick={pick} />
          <Chips title="Recent" list={resolveKeys(memory.recents, entries)} pick={pick} />
        </>
      )}
      {query ? (
        <ul className="authored-kind-list" aria-label={`${found.length} matches`}>
          {found.length ? (
            found.map(rowFor)
          ) : (
            <li className="authored-none">No kind matches “{query}”.</li>
          )}
        </ul>
      ) : (
        groupKinds(entries).map((group) => (
          <details key={group.name} className="authored-category">
            <summary>
              {group.name} <span>{group.entries.length}</span>
            </summary>
            <ul className="authored-kind-list">{group.entries.map(rowFor)}</ul>
          </details>
        ))
      )}
    </section>
  );
}
