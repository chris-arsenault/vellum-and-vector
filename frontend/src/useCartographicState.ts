import { useState } from "react";
import type { Geometry } from "geojson";
import type { Position, Template } from "./types";
import type { Workspace } from "./cartography";

export function useCartographicState() {
  const [geometryRole, setGeometryRole] = useState<"primary" | "footprint">("primary");
  const [workspace, setWorkspace] = useState<Workspace>("terrain");
  const [customLayer, setCustomLayer] = useState("");
  const [drawName, setDrawName] = useState("");
  const [drawAttributes, setDrawAttributes] = useState<Record<string, unknown>>({});
  const [entityId, setEntityId] = useState("");
  const [magicDraft, setMagicDraft] = useState<{
    id: string | null;
    source: Position;
    radius: number;
  } | null>(null);
  /** The generated landmark whose record is open for editing; landmarks are never drawn new. */
  const [landmarkDraft, setLandmarkDraft] = useState<{
    id: string;
    geometry: Geometry;
  } | null>(null);
  const [templateToPlace, setTemplateToPlace] = useState<Template | null>(null);
  const [interactionError, setInteractionError] = useState<Error | null>(null);
  return {
    geometryRole,
    setGeometryRole,
    workspace,
    setWorkspace,
    customLayer,
    setCustomLayer,
    drawName,
    setDrawName,
    drawAttributes,
    setDrawAttributes,
    entityId,
    setEntityId,
    magicDraft,
    setMagicDraft,
    landmarkDraft,
    setLandmarkDraft,
    templateToPlace,
    setTemplateToPlace,
    interactionError,
    setInteractionError,
  };
}
