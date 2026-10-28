import { useRef, useState } from "react";
import {
  regionFootprint,
  regionViews,
  regionLineage,
  spatial,
  refinedRegionArea,
  regionRefinementInput,
  regionSourceAreaId,
  type Bounds,
  type RegionCandidate,
  type RegionQuery,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { Tool, World, Position } from "./types";
import { atlasWorkspace, workspaceScope } from "./atlasWorkspace";
import { makeCommand, type useCommit } from "./useAtlas";
import type { MapEngine } from "./mapEngine";

interface Options {
  world: World;
  areaId: string;
  selectedRegionId: string | null;
  setRegionId: (id: string | null) => void;
  setAreaId: (id: string) => void;
  setSelected: (feature: import("./types").AtlasFeature | null) => void;
  setTool: (tool: Tool) => void;
  setPanel: (panel: string) => void;
  viewport: number[] | null;
  mapEngine: MapEngine | null;
  commit: ReturnType<typeof useCommit>;
}
export function isRegionTool(tool: Tool) {
  return ["regionPick", "regionOutline", "regionCut", "regionEdit"].includes(tool);
}
function useRegionDraft() {
  const request = useRef(0);
  const [regionDraft, setDraft] = useState<RegionCandidate | null>(null);
  const [candidates, setCandidates] = useState<RegionCandidate[]>([]);
  const [cuts, setCuts] = useState<Geometry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [regionError, setError] = useState<Error | null>(null);
  const clear = () => {
    request.current++;
    setDraft(null);
    setCandidates([]);
    setCuts([]);
    setEditingId(null);
    setError(null);
  };
  const attempt = async (work: () => Promise<() => void>) => {
    const current = ++request.current;
    try {
      setError(null);
      const apply = await work();
      if (current === request.current) apply();
    } catch (error) {
      if (current === request.current) setError(error as Error);
    }
  };
  return {
    regionDraft,
    candidates,
    cuts,
    editingId,
    regionError,
    setDraft,
    setCandidates,
    setCuts,
    setEditingId,
    clear,
    attempt,
  };
}
type Draft = ReturnType<typeof useRegionDraft>;
function regionContext(o: Options, d: Draft) {
  const sourceAreaId = regionSourceAreaId(o.world, o.selectedRegionId, o.areaId);
  const regions = regionViews(o.world, sourceAreaId);
  const region = regions.find((r) => r.id === o.selectedRegionId) ?? null;
  const parentId = d.editingId ? (region?.region.parentId ?? null) : (region?.id ?? null);
  const footprint = regionFootprint(o.world, sourceAreaId, region?.id ?? null);
  const viewport = (o.viewport as Bounds | null) ?? spatial.bounds(footprint);
  return { region, regions, parentId, footprint, viewport, sourceAreaId };
}
type Context = ReturnType<typeof regionContext>;
export function useRegions(o: Options) {
  const d = useRegionDraft(),
    c = regionContext(o, d);
  const enterRegion = (id: string | null) => {
    const target = o.world.views.find((v) => v.id === id && v.region);
    o.setAreaId(
      target ? (refinedRegionArea(o.world, target.id)?.id ?? target.areaId) : c.sourceAreaId
    );
    o.setRegionId(target?.id ?? null);
    o.setSelected(null);
    d.clear();
    o.setTool("select");
    o.setPanel("regions");
  };
  return {
    region: c.region,
    regions: c.regions,
    regionDraft: d.regionDraft,
    editingRegion: d.editingId !== null,
    regionCandidates: d.candidates,
    regionError: d.regionError,
    regionCuts: d.cuts,
    regionTrail: regionLineage(o.world, c.region?.id ?? null),
    refineSelectedRegion: () => {
      if (!c.region) return;
      const existing = refinedRegionArea(o.world, c.region.id);
      if (existing) {
        o.setAreaId(existing.id);
        o.setPanel("configure-generation");
        return;
      }
      o.commit.mutate(
        makeCommand(o.world, "createArea", regionRefinementInput(o.world, c.region.id)),
        {
          onSuccess: (result) => {
            o.setAreaId(refinedRegionArea(result.candidate, c.region!.id)!.id);
            o.setPanel("configure-generation");
            o.setTool("select");
          },
        }
      );
    },
    enterRegion,
    regionPresentation: {
      id: c.region?.id ?? null,
      sourceAreaId: o.areaId,
      footprint: c.footprint,
      name: c.region?.name ?? o.world.areas[o.areaId].name,
      regions: c.regions,
    },
    chooseRegionCandidate: (candidate: RegionCandidate) => {
      d.setDraft(candidate);
      o.setTool("regionEdit");
    },
    ...regionDrawing(o, d, c, enterRegion),
    ...regionCommands(o, d, c, enterRegion),
    openRegions: () => {
      d.clear();
      o.setPanel("regions");
      o.setTool("regionPick");
    },
    cancelRegion: () => {
      d.clear();
      o.setPanel("regions");
      o.setTool("select");
    },
    adjustRegion: () => {
      if (!c.region) return;
      d.clear();
      d.setEditingId(c.region.id);
      d.setDraft({ name: c.region.name, footprint: c.region.region.footprint });
      o.setTool("regionEdit");
    },
  };
}
function regionDrawing(o: Options, d: Draft, c: Context, enter: (id: string) => void) {
  const query = (position: Position | null): RegionQuery => ({
    scope: workspaceScope(o.world, c.sourceAreaId),
    sourceAreaId: c.sourceAreaId,
    parentId: c.parentId,
    editingId: d.editingId,
    cuts: d.cuts,
    position,
    viewport: c.viewport,
  });
  return {
    regionPick: (position: Position) =>
      d.attempt(async () => {
        const result = await (await atlasWorkspace()).regionChoices(query(position));
        return () => {
          if (result.childId) {
            enter(result.childId);
            return;
          }
          d.setCandidates(result.candidates);
          d.setDraft(result.candidates[0] ?? null);
          if (result.candidates.length) o.setTool("regionEdit");
          if (!result.candidates.length)
            throw new Error(
              "No smaller enclosed region here. Draw an outline or connect a dividing line to existing boundaries."
            );
        };
      }),
    regionDraw: (geometry: Geometry) =>
      d.attempt(async () => {
        const tolerance =
          (o.mapEngine?.map.getView().getResolution() ?? (c.viewport[2] - c.viewport[0]) / 800) *
          12;
        const result = await (
          await atlasWorkspace()
        ).drawRegion({ query: query(null), geometry, tolerance });
        return () => {
          d.setCuts(result.cuts);
          d.setDraft(
            result.candidate && {
              ...result.candidate,
              name: d.editingId ? (c.region?.name ?? result.candidate.name) : result.candidate.name,
            }
          );
          d.setCandidates(result.candidates);
          o.setTool(geometry.type.includes("LineString") ? "regionPick" : "regionEdit");
        };
      }),
  };
}
function regionCommands(o: Options, d: Draft, c: Context, enter: (id: string | null) => void) {
  return {
    saveRegion: (name: string) => {
      if (!d.regionDraft) return;
      const id = d.editingId ?? crypto.randomUUID();
      o.commit.mutate(
        makeCommand(o.world, "putView", {
          id,
          name: name.trim() || `Region ${c.regions.length + 1}`,
          areaId: c.sourceAreaId,
          layers: [],
          region: { parentId: c.parentId, footprint: d.regionDraft.footprint },
        }),
        {
          onSuccess: () => {
            o.setRegionId(id);
            o.setSelected(null);
            d.clear();
            o.setTool("select");
          },
        }
      );
    },
    renameRegion: (name: string) => {
      if (c.region && name.trim())
        o.commit.mutate(makeCommand(o.world, "putView", { ...c.region, name: name.trim() }));
    },
    removeRegion: () => {
      if (c.region)
        o.commit.mutate(makeCommand(o.world, "removeView", { id: c.region.id }), {
          onSuccess: () => enter(c.region!.region.parentId),
        });
    },
  };
}
