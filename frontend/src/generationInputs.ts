import type {
  DomainSnapshot,
  FeatureWorkspace,
  NetworkWorkspace,
  AuthoringFeatureQuery,
  SpatialStore,
} from "@atlas/domain";

/** Geometry moves directly from catalog pages into the worker's immutable source records. */
export async function loadGenerationFeatures(
  source: DomainSnapshot,
  catalog: Pick<SpatialStore, "readAuthoringPage">,
  features: Pick<FeatureWorkspace, "put">,
  check: () => void = () => {},
  networks?: Pick<NetworkWorkspace, "putNode" | "putReach">
) {
  const input: AuthoringFeatureQuery = {
    scope: source.scope,
    featureIds: Object.keys(source.world.features),
    layers: Object.keys(source.world.layers),
    dependencies: true,
    unconnectedNodes: Boolean(networks),
  };
  for (const feature of Object.values(source.world.features)) features.put(feature);
  source.world.features = {};
  storeNetworks(source, networks);
  const revisions = new Set(source.revisions.map((r) => `${r.kind}:${r.id}`));
  let after: string | null = null;
  do {
    check();
    const page = await catalog.readAuthoringPage(input, after, 64);
    check();
    for (const feature of Object.values(page.snapshot.world.features)) features.put(feature);
    storeNetworks(page.snapshot, networks);
    mergeContext(source, page.snapshot);
    for (const revision of page.snapshot.revisions) {
      const key = `${revision.kind}:${revision.id}`;
      if (!revisions.has(key)) {
        source.revisions.push(revision);
        revisions.add(key);
      }
    }
    after = page.next;
  } while (after);
}
function storeNetworks(
  source: DomainSnapshot,
  networks?: Pick<NetworkWorkspace, "putNode" | "putReach">
) {
  if (!networks) return;
  for (const node of Object.values(source.world.networkNodes ?? {})) networks.putNode(node);
  for (const reach of Object.values(source.world.networkReaches ?? {})) networks.putReach(reach);
  source.world.networkNodes = {};
  source.world.networkReaches = {};
}
function mergeContext(source: DomainSnapshot, page: DomainSnapshot) {
  const world = source.world;
  for (const key of [
    "areas",
    "layers",
    "entities",
    "connections",
    "networkNodes",
    "networkReaches",
  ] as const)
    Object.assign((world[key] ??= {}), page.world[key]);
  mergeList(world.fields, page.world.fields);
  mergeList(world.views, page.world.views);
  Object.assign(source.identities, page.identities);
}
function mergeList<T extends { id: string }>(target: T[], values: T[]) {
  const ids = new Set(target.map((value) => value.id));
  for (const value of values) if (!ids.has(value.id)) target.push(value);
}
