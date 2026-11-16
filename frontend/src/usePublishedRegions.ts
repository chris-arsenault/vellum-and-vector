import { useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { useQuery } from "@tanstack/react-query";
import type {
  Bounds,
  Geometry,
  MapDescriptor,
  MapNavigation,
  MapRegion,
  Position,
  RegionCandidate,
  RegionQuery,
  MapReader,
} from "@atlas/map";
import type { PublishedTool } from "./publishedInteractions";
import type { PublishedNavigationState } from "./usePublishedNavigation";
import { asError } from "./usePublishedNavigation";
import type { PublishedPresentation } from "./PublishedMapView";

interface Options {
  map: MapDescriptor;
  navigation: MapNavigation;
  reader: MapReader;
  saved: PublishedNavigationState;
  tool: PublishedTool;
  setTool(tool: PublishedTool): void;
  enterMap(reference: import("@atlas/map").MapRef): void;
  initialRegionId?: string | null;
}
interface Draft {
  candidate: RegionCandidate;
  candidates: RegionCandidate[];
  version: number;
}
function useRegionDraft() {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cuts, setCuts] = useState<Geometry[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const request = useRef(0);
  const clear = () => {
    request.current++;
    setDraft(null);
    setCuts([]);
    setEditingId(null);
    setError(null);
  };
  const attempt = async (work: () => Promise<() => void>) => {
    const current = ++request.current;
    setError(null);
    try {
      const apply = await work();
      if (current === request.current) apply();
    } catch (error) {
      if (current === request.current) setError(asError(error));
    }
  };
  return { draft, editingId, cuts, error, clear, attempt, setDraft, setCuts, setEditingId };
}
type RegionDraftState = ReturnType<typeof useRegionDraft>;
export function usePublishedRegions(options: Options) {
  const [id, setId] = useState<string | null>(options.initialRegionId ?? null);
  const d = useRegionDraft();
  const { draft, editingId, cuts, error, setDraft, setEditingId } = d;
  const regions = options.saved.state?.regions ?? emptyRegions;
  const ancestry = useMemo(() => regionAncestry(regions, id), [regions, id]);
  const region = regions.find((region) => region.id === id) ?? null;
  const areas = useRegionAreas(options, regions, draft);
  const parentId = editingId ? region!.parentId : id;
  const cancel = () => {
    d.clear();
    options.setTool("inspect");
  };
  const enter = (next: string | null) => {
    const target = regions.find((region) => region.id === next);
    cancel();
    if (target?.child) options.enterMap(target.child);
    else setId(next);
  };
  const query = (position: Position | null, viewport: Bounds): RegionQuery => ({
    spaceId: options.map.primarySpaceId,
    parentId,
    editingId,
    position,
    viewport,
    cuts,
  });
  const actions = regionActions(options, {
    draft,
    editingId,
    parentId,
    region,
    regions,
    cancel,
    setId,
    setDraft,
    setEditingId,
  });
  return {
    id,
    region,
    regions,
    draft,
    cuts,
    error: error ?? areas.error,
    area: areas.format,
    editingId,
    parentId,
    enter,
    cancel,
    /** Drops an unfinished outline, its dividing lines and any pending boundary request. */
    discard: d.clear,
    select: (next: string | null) => {
      cancel();
      setId(next);
    },
    footprint: region?.geometry ?? options.map.footprint,
    ancestry,
    ...actions,
    choose: (candidate: RegionCandidate) => {
      if (draft) setDraft({ ...draft, candidate });
      options.setTool("region-edit");
    },
    begin: () => {
      cancel();
      options.setTool("region-pick");
    },
    ...regionDrawing(options, d, query, enter, region),
  };
}
function useRegionAreas(options: Options, regions: MapRegion[], draft: Draft | null) {
  const shapes = useMemo(
    () => [
      ...new Set([
        ...regions.map((region) => region.geometry),
        ...(draft ? [draft.candidate.geometry, ...draft.candidates.map((c) => c.geometry)] : []),
      ]),
    ],
    [regions, draft]
  );
  const result = useQuery({
    queryKey: ["region-areas", options.map.reference, shapes],
    queryFn: ({ signal }) =>
      options.reader.areas(options.map.reference, options.map.primarySpaceId, shapes, { signal }),
    enabled: shapes.length > 0,
  });
  return {
    error: result.error,
    format: (shape: Geometry) => {
      const area = result.data?.[shapes.indexOf(shape as MapRegion["geometry"])];
      return area === undefined
        ? "…"
        : (area / 1e6).toLocaleString(undefined, {
            maximumFractionDigits: 2,
          });
    },
  };
}
function regionDrawing(
  options: Options,
  d: RegionDraftState,
  query: (position: Position | null, viewport: Bounds) => RegionQuery,
  enter: (id: string) => void,
  region: MapRegion | null
) {
  return {
    pick: (position: Position, viewport: Bounds) =>
      d.attempt(async () => {
        if (!options.saved.state) throw new Error("Wait for map regions to load.");
        const result = await options.navigation.choices(
          options.map.reference,
          options.saved.state,
          query(position, viewport)
        );
        return () => {
          if (result.childId) return enter(result.childId);
          if (!result.candidates.length)
            throw new Error("No region here. Draw an outline or a dividing line.");
          d.setDraft({
            candidate: result.candidates[0],
            candidates: result.candidates,
            version: result.version,
          });
          options.setTool("region-edit");
        };
      }),
    draw: (geometry: Geometry, viewport: Bounds, tolerance: number) =>
      d.attempt(async () => {
        if (!options.saved.state) throw new Error("Wait for map regions to load.");
        const result = await options.navigation.draw(options.map.reference, options.saved.state, {
          query: query(null, viewport),
          geometry,
          tolerance,
        });
        return () => {
          d.setCuts(result.cuts);
          d.setDraft(
            result.candidate
              ? {
                  candidate: {
                    ...result.candidate,
                    name: d.editingId ? region!.name : result.candidate.name,
                  },
                  candidates: result.candidates,
                  version: result.version,
                }
              : null
          );
          options.setTool(geometry.type.includes("LineString") ? "region-pick" : "region-edit");
        };
      }),
  };
}
type RegionState = { region: MapRegion | null; regions: MapRegion[] };
function regionActions(
  options: Options,
  context: RegionState & {
    draft: Draft | null;
    editingId: string | null;
    parentId: string | null;
    cancel(): void;
    setId(id: string | null): void;
    setDraft(draft: Draft | null): void;
    setEditingId(id: string | null): void;
  }
) {
  const { region, draft } = context;
  return {
    save: async (name: string) => {
      if (!draft) return;
      const id = context.editingId ?? uuid();
      await options.saved.commit(
        {
          kind: "putRegion",
          data: {
            id,
            name: name.trim() || `Region ${context.regions.length + 1}`,
            spaceId: options.map.primarySpaceId,
            parentId: context.parentId,
            geometry: draft.candidate.geometry,
            child: region?.id === id ? region.child : null,
          },
        },
        draft.version
      );
      context.cancel();
      context.setId(id);
    },
    rename: async (name: string) => {
      if (region && name.trim())
        await options.saved.commit({ kind: "putRegion", data: { ...region, name: name.trim() } });
    },
    remove: async () => {
      if (!region) return;
      await options.saved.commit({ kind: "removeRegion", data: region.id });
      context.cancel();
      context.setId(region.parentId);
    },
    adjust: () => {
      if (!region || region.child || !options.saved.state) return;
      context.cancel();
      context.setEditingId(region.id);
      context.setDraft({
        candidate: { name: region.name, geometry: region.geometry },
        candidates: [],
        version: options.saved.state.version,
      });
      options.setTool("region-edit");
    },
  };
}
export type PublishedRegionsState = ReturnType<typeof usePublishedRegions>;
export function usePublishedRegionPresentation(
  value: PublishedPresentation,
  regions: PublishedRegionsState
) {
  return useMemo(
    () => ({ ...value, footprint: regions.footprint, ancestry: regions.ancestry }),
    [value, regions.footprint, regions.ancestry]
  );
}
const emptyRegions: MapRegion[] = [];
function regionAncestry(regions: MapRegion[], id: string | null) {
  const result: string[] = [];
  for (let current = id; current;) {
    result.unshift(current);
    current = regions.find((region) => region.id === current)?.parentId ?? null;
  }
  return result;
}
