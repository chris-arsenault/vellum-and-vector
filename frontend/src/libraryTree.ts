import type { ContextInventory, GenerationStatus, StoredContext } from "@atlas/context";

/** A map in the library tree, with the generation that produced it and what was refined from it. */
export interface MapNode {
  kind: "map";
  map: StoredContext;
  /** The job that made this map, when the host still holds it. */
  job?: GenerationStatus;
  children: LibraryNode[];
}
/** A generation with no map to merge into: running, stopped, failed, or its map is gone. */
export interface JobNode {
  kind: "job";
  job: GenerationStatus;
  children: [];
}
export type LibraryNode = MapNode | JobNode;
export interface Library {
  roots: LibraryNode[];
  /** Complete maps replaced by a newer revision of the same map. */
  superseded: StoredContext[];
  /** Maps whose parent is not in the library at all. */
  detached: StoredContext[];
}

export const mapKey = (map: StoredContext) => `${map.reference.mapId}:${map.reference.revision}`;

/** Worlds at the top, regions under the map they were refined from, jobs under their map. */
export function buildLibrary(inventory: ContextInventory, jobs: GenerationStatus[]): Library {
  const shown = inventory.maps.filter((map) => map.head || !map.complete);
  const known = new Set(inventory.maps.map((map) => map.reference.mapId));
  const nodes = new Map<string, MapNode>(
    shown.map((map) => [map.reference.mapId, { kind: "map", map, children: [] }])
  );
  const library: Library = {
    roots: [],
    detached: [],
    superseded: inventory.maps.filter((map) => map.complete && !map.head),
  };
  for (const node of nodes.values()) {
    const parent = node.map.parent?.mapId;
    if (parent && nodes.has(parent)) nodes.get(parent)!.children.push(node);
    else if (parent && !known.has(parent)) library.detached.push(node.map);
    else library.roots.push(node);
  }
  for (const job of jobs) place(job, nodes, library);
  return library;
}
function place(job: GenerationStatus, nodes: Map<string, MapNode>, library: Library) {
  const made = job.result && nodes.get(job.result.mapId);
  if (made && !made.job) {
    made.job = job;
    return;
  }
  const parent = job.details?.parent && nodes.get(job.details.parent.mapId);
  (parent ? parent.children : library.roots).push({ kind: "job", job, children: [] });
}
