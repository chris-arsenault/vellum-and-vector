import { useQuery } from "@tanstack/react-query";
import type { AtlasContext, StoredContext } from "@atlas/context";
import type { MapDescriptor, MapRef } from "@atlas/map";
import { ErrorMessage } from "./ErrorMessage";

type Context = Pick<AtlasContext<unknown>, "contexts" | "mode">;
interface Tree {
  children: Map<string, StoredContext[]>;
  roots: StoredContext[];
  /** Ids from the open map up to its world. */
  path: Set<string>;
}

function buildTree(maps: StoredContext[], current: string): Tree {
  const heads = maps.filter((map) => map.head);
  const byId = new Map(heads.map((map) => [map.reference.mapId, map]));
  const children = new Map<string, StoredContext[]>();
  const roots: StoredContext[] = [];
  for (const map of heads) {
    const parent = map.parent?.mapId;
    if (parent && byId.has(parent)) children.set(parent, [...(children.get(parent) ?? []), map]);
    else roots.push(map);
  }
  const path = new Set<string>();
  for (let id: string | undefined = current; id && !path.has(id);) {
    path.add(id);
    id = byId.get(id)?.parent?.mapId;
  }
  return { children, roots, path };
}
function MapNode({
  map,
  tree,
  current,
  open,
}: {
  map: StoredContext;
  tree: Tree;
  current: string;
  open(reference: MapRef): void;
}) {
  const id = map.reference.mapId;
  const kids = tree.children.get(id) ?? [];
  const here = id === current;
  const label = (
    <button
      aria-current={here ? "location" : undefined}
      disabled={!map.complete}
      onClick={() => open(map.reference)}
    >
      <span>{map.name}</span>
      {!map.complete && <small>Not finished</small>}
    </button>
  );
  if (!kids.length) return <li>{label}</li>;
  return (
    <li>
      <details open={tree.path.has(id)}>
        <summary>{label}</summary>
        <ul>
          {kids.map((child) => (
            <MapNode
              key={child.reference.mapId}
              map={child}
              tree={tree}
              current={current}
              open={open}
            />
          ))}
        </ul>
      </details>
    </li>
  );
}
/** Every world and the maps refined from it, as an expandable tree with the open map marked. */
export function MapTree({
  context,
  map,
  open,
}: {
  context: Context;
  map: MapDescriptor;
  open(reference: MapRef): void;
}) {
  const inventory = useQuery({
    queryKey: ["stored-contexts", context.mode],
    queryFn: ({ signal }) => context.contexts.list({ signal }),
  });
  const tree = inventory.data && buildTree(inventory.data.maps, map.reference.mapId);
  return (
    <nav className="region-list map-tree" aria-label="Maps">
      <h3>Worlds and maps</h3>
      {inventory.isPending && <p role="status">Loading maps…</p>}
      {tree && (
        <ul>
          {tree.roots.map((root) => (
            <MapNode
              key={root.reference.mapId}
              map={root}
              tree={tree}
              current={map.reference.mapId}
              open={open}
            />
          ))}
        </ul>
      )}
      {tree?.roots.length === 0 && <p className="hint">No maps yet.</p>}
      <ErrorMessage error={inventory.error} />
    </nav>
  );
}
