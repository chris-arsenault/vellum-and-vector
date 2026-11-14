import type {
  FeatureReader,
  FeatureWorkspace,
  NetworkReader,
  NetworkWorkspace,
} from "@atlas/domain";

/** Leave paging and live reads with the workspace; WASM receives one detached record at a time. */
function records<T>(values: Iterable<T>) {
  const iterator = values[Symbol.iterator]();
  return {
    next(): string | undefined {
      const item = iterator.next();
      return item.done ? undefined : JSON.stringify(item.value);
    },
    close() {
      iterator.return?.();
    },
  };
}
export function rustFeatureReader(workspace: FeatureReader) {
  return {
    get: (id: string) => JSON.stringify(workspace.get(id) ?? null),
    values: (selection: string) => records(workspace.values(JSON.parse(selection))),
  };
}
export function rustFeatureWorkspace(workspace: FeatureWorkspace) {
  return {
    ...rustFeatureReader(workspace),
    put: (feature: string) => workspace.put(JSON.parse(feature)),
    remove: (id: string) => workspace.remove(id),
    revisions: () => records(workspace.revisions()),
  };
}
export function rustNetworkReader(workspace: NetworkReader) {
  return {
    node: (id: string) => JSON.stringify(workspace.node(id) ?? null),
    reach: (id: string) => JSON.stringify(workspace.reach(id) ?? null),
    nodes: () => records(workspace.nodes()),
    reaches: (selection: string) => records(workspace.reaches(JSON.parse(selection))),
  };
}
export function rustNetworkWorkspace(workspace: NetworkWorkspace) {
  return {
    ...rustNetworkReader(workspace),
    putNode: (node: string) => workspace.putNode(JSON.parse(node)),
    putReach: (reach: string) => workspace.putReach(JSON.parse(reach)),
    removeReach: (id: string) => workspace.removeReach(id),
  };
}
