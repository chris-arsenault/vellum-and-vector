import { useState } from "react";
import { point, spatial } from "@atlas/domain";
import { Brand } from "./App";
import { ErrorMessage } from "./ErrorMessage";
import { MapCanvas } from "./MapCanvas";
import { MapDrawer, type MapSection } from "./MapPanel";
import { Inspector } from "./Inspector";
import { WorkflowPanel } from "./WorkflowPanel";
import { JobsPanel } from "./JobsPanel";
import { useEditor, type EditorState } from "./useEditor";
import { lineage } from "./presentation";
import { exportWorld } from "./atlasReads";
import { download } from "./download";
import type { Tool, World } from "./types";
import { ToolIcon } from "./ToolIcon";
import { useJobs } from "./useAtlas";
import { UndoButton } from "./UndoButton";
import { paletteTools, toolLabel, workspaces, type Workspace } from "./cartography";
import { MapStorage } from "./MapStorage";
import { RegionList } from "./RegionsPanel";

interface Props {
  world: World;
  worlds: { id: string; name: string }[];
  changeWorld: (id: string) => void;
  newWorld: () => void;
  openLore: () => void;
  openSaved: (id: string) => void;
}
export function Editor({ world, worlds, changeWorld, newWorld, openLore, openSaved }: Props) {
  const editor = useEditor(world);
  const [tab, setTab] = useState<string | null>(null);
  const [mapSection, setMapSection] = useState<MapSection>("appearance");
  const toggle = (next: string) => setTab(tab === next ? null : next);
  return (
    <div className="app-shell">
      <EditorHeader
        world={world}
        worlds={worlds}
        changeWorld={changeWorld}
        newWorld={newWorld}
        openLore={openLore}
        openSaved={openSaved}
      />
      <nav className="map-navigation" aria-label="Workspace panels">
        <button
          aria-expanded={tab === "atlas"}
          aria-controls="map-drawer"
          onClick={() => toggle("atlas")}
        >
          Atlas
        </button>
        <button
          aria-expanded={tab === "map"}
          aria-controls="map-drawer"
          onClick={() => toggle("map")}
        >
          Map
        </button>
      </nav>
      {tab && (
        <MapDrawer
          editor={editor}
          tab={tab}
          section={mapSection}
          choose={setMapSection}
          close={() => setTab(null)}
          maps={
            <>
              <AtlasTree world={world} current={editor.area.id} enter={editor.enter} />
              <button onClick={editor.openRegions}>Choose a region</button>
              <RegionList editor={editor} />
            </>
          }
        />
      )}
      <MapWorkspace world={world} editor={editor} />
      <AuthoringPanel world={world} editor={editor} />
    </div>
  );
}
function EditorHeader({ world, worlds, changeWorld, newWorld, openLore, openSaved }: Props) {
  return (
    <header className="app-header">
      <Brand />
      <div className="world-picker">
        <label className="sr-only" htmlFor="world-picker">
          World
        </label>
        <select
          id="world-picker"
          value={world.id}
          onChange={(event) => changeWorld(event.target.value)}
        >
          {worlds.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <button className="quiet" onClick={newWorld}>
          + New world
        </button>
      </div>
      <MapStorage world={world} onOpen={openSaved} />
      <button className="quiet" onClick={openLore}>
        Lore
      </button>
      <button
        className="quiet"
        onClick={async () => download(`${world.name}.geojson`, await exportWorld(world.id))}
      >
        Export GIS
      </button>
    </header>
  );
}
function MapWorkspace({ world, editor }: { world: World; editor: EditorState }) {
  return (
    <main className="map-workspace">
      <MapBreadcrumbs world={world} editor={editor} />
      <div className="map-toolbar">
        <ToolButtons
          current={editor.tool}
          choose={editor.setTool}
          palette={paletteTools(editor.workspace, world.layers[editor.customLayer])}
        />
        <UndoButton world={world} />
        <button onClick={editor.openRegions} aria-pressed={editor.panel === "regions"}>
          Regions
        </button>
        <label>
          Work on
          <select
            aria-label="Working layer"
            value={editor.workspace}
            onChange={(event) => editor.setWorkspace(event.target.value as Workspace)}
          >
            {Object.entries(workspaces).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SubjectCanvas world={world} editor={editor} />
      <MapStatus world={world} editor={editor} />
    </main>
  );
}
function MapBreadcrumbs({ world, editor }: { world: World; editor: EditorState }) {
  return (
    <nav className="breadcrumbs" aria-label="Geographic lineage">
      {lineage(world, editor.area.id).map((area) => (
        <button key={area.id} onClick={() => editor.enter(area.id)}>
          {area.name}
          <small>{area.profile}</small>
        </button>
      ))}
      {editor.regionTrail.map((region) => (
        <button
          key={region.id}
          onClick={() => editor.enterRegion(region.id)}
          aria-current={editor.region?.id === region.id ? "location" : undefined}
        >
          {region.name}
        </button>
      ))}
    </nav>
  );
}
function SubjectCanvas({ world, editor }: { world: World; editor: EditorState }) {
  const proposal = editor.regionDraft
    ? [
        {
          id: "region-draft",
          geometry: editor.regionDraft.footprint,
        } as import("./types").AtlasFeature,
      ]
    : editor.magicDraft
      ? [
          {
            id: "magic-reach",
            geometry: spatial.buffer(point(editor.magicDraft.source), editor.magicDraft.radius),
          } as import("./types").AtlasFeature,
        ]
      : editor.drawing
        ? [{ id: "drawing", geometry: editor.drawing } as import("./types").AtlasFeature]
        : editor.selection
          ? [
              {
                id: "region-selection",
                geometry: editor.selection,
              } as import("./types").AtlasFeature,
            ]
          : editor.proposedFeatures;
  return (
    <MapCanvas
      world={world}
      area={editor.area}
      styles={editor.styles}
      raster={editor.raster.data}
      baseRaster={editor.baseRaster.data}
      presentation={{ raster: editor.rasterView, cartography: editor.cartography }}
      onEngine={editor.setMapEngine}
      tool={editor.tool}
      selection={{
        feature: editor.selected,
        role: editor.geometryRole,
        region: editor.regionPresentation,
      }}
      events={{
        select: editor.select,
        draw: editor.draw,
        extent: editor.selectExtent,
        modify: editor.modify,
        stroke: editor.stroke,
        cancel: editor.cancel,
        enter: editor.enter,
        viewport: editor.viewport,
        pickRegion: editor.regionPick,
        enterRegion: editor.enterRegion,
      }}
      proposal={proposal}
      features={editor.scene.data ?? []}
    />
  );
}
function MapStatus({ world, editor }: { world: World; editor: EditorState }) {
  const jobs = useJobs(world.id);
  const generating = jobs.data?.some((job) => job.status === "running");
  const partial = jobs.data?.[0]?.partial;
  return (
    <div className="map-status">
      <span>
        {editor.area.profile} ·{" "}
        {generating
          ? "Generation in progress"
          : partial
            ? "Incomplete generation"
            : Object.values(editor.area.layers).includes("stale")
              ? "Needs reconciliation"
              : "Committed geography"}
      </span>
      <span>
        {world.featureCount ?? Object.keys(world.features).length} world features ·{" "}
        {world.areas[editor.area.id].boundary?.crossings.length ?? 0} locked crossings
      </span>
      <span>Revision {world.version}</span>
    </div>
  );
}
function AuthoringPanel({ world, editor }: { world: World; editor: EditorState }) {
  return (
    <aside className="right-panel">
      <nav className="panel-tabs" aria-label="Authoring panels">
        {[
          ["generate", "Develop"],
          ["author", "Draw & edit"],
          ["inspect", "Inspect"],
          ["more", "Library"],
        ].map(([name, label]) => (
          <button
            key={name}
            aria-pressed={editor.panel === name}
            onClick={() => editor.setPanel(name)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="panel-content">
        {editor.panel === "inspect" ? (
          <Inspector world={world} editor={editor} />
        ) : (
          <WorkflowPanel world={world} editor={editor} />
        )}
        <ErrorMessage
          error={
            editor.commit.error ??
            editor.scene.error ??
            editor.raster.error ??
            editor.baseRaster.error
          }
        />
        <ErrorMessage error={editor.interactionError} />
      </div>
      <JobsPanel world={world} />
    </aside>
  );
}
function AtlasTree({
  world,
  current,
  enter,
}: {
  world: World;
  current: string;
  enter: (id: string) => void;
}) {
  return (
    <div className="atlas-tree">
      <div className="section-title">
        <span>MAPPED AREAS</span>
        <span>{Object.keys(world.areas).length}</span>
      </div>
      {Object.values(world.areas).map((area) => (
        <button
          className={`area-row depth-${lineage(world, area.id).length} ${area.id === current ? "active" : ""}`}
          key={area.id}
          onClick={() => enter(area.id)}
        >
          <span className="area-symbol">{area.profile === "interior" ? "▦" : "◇"}</span>
          <span>
            {area.name}
            <small>
              {area.profile} ·{" "}
              {Object.values(area.layers).includes("stale")
                ? "stale"
                : area.parentId
                  ? "anchored"
                  : "world root"}
            </small>
          </span>
        </button>
      ))}
      <p className="hint tree-hint">
        Draw a refinement extent or select a place to develop it. Other areas retain their existing
        detail.
      </p>
    </div>
  );
}
function ToolButtons({
  current,
  choose,
  palette,
}: {
  current: Tool;
  choose: (tool: Tool) => void;
  palette: Tool[];
}) {
  const tools: Tool[] = ["select", "pan", "move", "reshape", ...palette, "refine"];
  return (
    <div className="tools" role="toolbar" aria-label="Map tools">
      {tools.map((id) => (
        <button
          key={id}
          title={toolLabel(id)}
          aria-label={toolLabel(id)}
          aria-pressed={current === id}
          onClick={() => choose(id)}
        >
          <ToolIcon tool={id} />
        </button>
      ))}
    </div>
  );
}
