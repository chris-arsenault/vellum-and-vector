import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import GeoJSON from "ol/format/GeoJSON.js";
import type { RegistryQuery, AtlasFeature } from "@atlas/domain";
import type { Connection, World } from "./types";
import { atlasWorkspace, workspaceScope } from "./atlasWorkspace";

const allFeatures: RegistryQuery = {
  search: "",
  type: "",
  status: "",
  state: "",
  profile: "",
  space: "",
  named: false,
  protectedOnly: false,
  attributes: [],
};
const pageSize = 100;

/** Search the mapped area's catalog; only the chosen endpoint needs canonical geometry. */
interface AccessProps {
  world: World;
  value: Connection["a"];
  change: (end: Connection["a"]) => void;
}
function useAccessFeatures({ world, value, change }: AccessProps) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const scope = workspaceScope(world, value.areaId);
  const result = useQuery({
    queryKey: ["accessFeatures", world.id, world.version, value.areaId, search, page],
    gcTime: 0,
    queryFn: async () =>
      (await atlasWorkspace()).readRegistry({
        worldId: world.id,
        areaId: value.areaId,
        query: { ...allFeatures, search },
        sort: { key: "name", descending: false },
        page,
        limit: pageSize,
      }),
  });
  const selected = useQuery({
    queryKey: ["accessFeature", world.id, world.version, value.areaId, value.featureId],
    enabled: !!value.featureId,
    queryFn: async () => (await atlasWorkspace()).readFeature(scope, value.featureId!),
  });
  const attachment = useMutation({
    mutationFn: async (id: string) => (await atlasWorkspace()).readFeature(scope, id),
  });
  const attach = (id: string) => {
    if (!id) {
      change({ ...value, featureId: null });
      return;
    }
    attachment.mutate(id, {
      onSuccess(feature) {
        change(attachFeature(value, feature));
      },
    });
  };
  const rows = result.data?.rows ?? [],
    current = result.data?.page ?? page;
  const error = result.error ?? selected.error ?? attachment.error;
  return { search, setSearch, setPage, result, selected, attachment, attach, rows, current, error };
}
function attachFeature(value: Connection["a"], feature: AtlasFeature): Connection["a"] {
  const [x, y] = new GeoJSON()
    .readGeometry(feature.geometry)
    ?.getClosestPoint([value.position.x, value.position.y]) ?? [value.position.x, value.position.y];
  const z =
    typeof feature.attributes.elevation === "number"
      ? feature.attributes.elevation
      : value.position.z;
  return { ...value, featureId: feature.id, position: { x, y, z } };
}
export function AccessFeature(props: AccessProps) {
  const { value } = props;
  const model = useAccessFeatures(props);
  const { search, setSearch, setPage, selected, attachment, attach, rows, error } = model;
  return (
    <>
      <label>
        Find access feature
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
      </label>
      <label>
        Access feature
        <select
          value={value.featureId ?? ""}
          disabled={attachment.isPending}
          onChange={(event) => attach(event.target.value)}
        >
          <option value="">Located endpoint without feature</option>
          {value.featureId && !rows.some(({ feature }) => feature.id === value.featureId) && (
            <option value={value.featureId}>{selected.data?.name ?? "Selected feature"}</option>
          )}
          {rows.map(({ feature }) => (
            <option key={feature.id} value={feature.id}>
              {feature.name}
            </option>
          ))}
        </select>
      </label>
      <AccessPages model={model} />
      {error && <p role="alert">{error.message}</p>}
    </>
  );
}
function AccessPages({ model }: { model: ReturnType<typeof useAccessFeatures> }) {
  const { current, result, setPage } = model;
  return (
    <nav aria-label="Access feature pages">
      <button
        type="button"
        disabled={!current || result.isFetching}
        onClick={() => setPage(current - 1)}
      >
        Previous page
      </button>
      <span>
        Page {current + 1} of {Math.max(1, Math.ceil((result.data?.matching ?? 0) / pageSize))}
      </span>
      <button
        type="button"
        disabled={result.isFetching || (current + 1) * pageSize >= (result.data?.matching ?? 0)}
        onClick={() => setPage(current + 1)}
      >
        Next page
      </button>
    </nav>
  );
}
