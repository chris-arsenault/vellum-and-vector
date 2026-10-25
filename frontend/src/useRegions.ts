import { useState } from "react";
import {
  availableRegionFootprint,
  regionFootprint,
  regionViews,
  regionLineage,
  regionCandidates,
  snapRegionCut,
  spatial,
  usefulRegionSize,
  type Bounds,
  type RegionCandidate,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { Tool, World, Position } from "./types";
import { readScene } from "./atlasReads";
import { session } from "./atlasState";
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
  const [regionDraft, setDraft] = useState<RegionCandidate | null>(null);
  const [candidates, setCandidates] = useState<RegionCandidate[]>([]);
  const [cuts, setCuts] = useState<Geometry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [regionError, setError] = useState<Error | null>(null);
  const clear = () => {
    setDraft(null);
    setCandidates([]);
    setCuts([]);
    setEditingId(null);
    setError(null);
  };
  const attempt = (work: () => void) => {
    try {
      setError(null);
      work();
    } catch (error) {
      setError(error as Error);
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
  const regions = regionViews(o.world, o.areaId);
  const region = regions.find((r) => r.id === o.selectedRegionId) ?? null;
  const parentId = d.editingId ? (region?.region.parentId ?? null) : (region?.id ?? null);
  const footprint = regionFootprint(o.world, o.areaId, region?.id ?? null);
  const parent = regionFootprint(o.world, o.areaId, parentId);
  const viewport = (o.viewport as Bounds | null) ?? spatial.bounds(footprint);
  const available = () => {
    const shape = availableRegionFootprint(o.world, o.areaId, parentId, d.editingId);
    if (!shape) throw new Error("This parent is fully subdivided. Open one of its regions.");
    return shape;
  };
  return { region, regions, parentId, footprint, parent, viewport, available };
}
type Context = ReturnType<typeof regionContext>;
export function useRegions(o: Options) {
  const d = useRegionDraft(),
    c = regionContext(o, d);
  const enterRegion = (id: string | null) => {
    const target = o.world.views.find((v) => v.id === id && v.region);
    if (target) o.setAreaId(target.areaId);
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
    regionCandidates: d.candidates,
    regionError: d.regionError,
    regionCuts: d.cuts,
    regionTrail: regionLineage(o.world, c.region?.id ?? null),
    enterRegion,
    regionPresentation: {
      id: c.region?.id ?? null,
      sourceAreaId: o.areaId,
      footprint: c.footprint,
      name: c.region?.name ?? o.world.areas[o.areaId].name,
      regions: c.regions,
    },
    chooseRegionCandidate: d.setDraft,
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
  const propose = (lines: Geometry[], position: Position | null) => {
    const choices = regionCandidates(
      c.available(),
      regionSources(o.world, o.areaId),
      lines,
      position,
      c.viewport
    ).filter((v) => spatial.area(v.footprint) < spatial.area(c.parent));
    d.setCandidates(choices);
    d.setDraft(choices[0] ?? null);
    if (!choices.length)
      throw new Error(
        "No smaller enclosed region here. Draw an outline or connect a dividing line to existing boundaries."
      );
  };
  return {
    regionPick: (position: Position) =>
      d.attempt(() => {
        const child = c.regions.find(
          (r) =>
            r.region.parentId === (c.region?.id ?? null) &&
            spatial.pointCoverage(r.region.footprint)(position)
        );
        if (child && !d.cuts.length) {
          enter(child.id);
          return;
        }
        propose(d.cuts, position);
      }),
    regionDraw: (geometry: Geometry) => d.attempt(() => drawRegion(o, d, c, propose, geometry)),
  };
}
function drawRegion(
  o: Options,
  d: Draft,
  c: Context,
  propose: (lines: Geometry[], position: Position | null) => void,
  geometry: Geometry
) {
  if (geometry.type === "LineString") {
    const boundaries = [
      c.available(),
      ...regionSources(o.world, o.areaId).map((s) => s.footprint),
      ...d.cuts,
    ];
    const tolerance =
      (o.mapEngine?.map.getView().getResolution() ?? (c.viewport[2] - c.viewport[0]) / 800) * 12;
    const next = [...d.cuts, snapRegionCut(geometry, boundaries, tolerance)];
    d.setCuts(next);
    propose(next, null);
    o.setTool("regionPick");
    return;
  }
  const clipped = spatial.intersection(c.available(), geometry);
  if (!clipped || !usefulRegionSize(clipped))
    throw new Error("Choose a larger outline inside the available parent region.");
  d.setDraft({ name: d.editingId ? (c.region?.name ?? "Region") : "Region", footprint: clipped });
  d.setCandidates([]);
  o.setTool("regionEdit");
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
          areaId: o.areaId,
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
function regionSources(world: World, areaId: string): RegionCandidate[] {
  const sources = readScene(world.id, areaId)
    .map((f) => ({ ...f, geometry: f.footprint ?? f.geometry }))
    .filter((f) =>
      ["Polygon", "MultiPolygon", "LineString", "MultiLineString"].includes(f.geometry.type)
    )
    .map((f) => ({ name: f.name, footprint: f.geometry }));
  const field = Object.values(session(world.id).snapshot.numerical).find(
    (f) => f.scope.areaId === areaId && f.ocean
  );
  if (field?.ocean) {
    sources.push({ name: "Sea", footprint: field.ocean });
    const land = spatial.difference(world.areas[areaId].footprint, field.ocean);
    if (land) sources.push({ name: "Land", footprint: land });
  }
  return sources;
}
