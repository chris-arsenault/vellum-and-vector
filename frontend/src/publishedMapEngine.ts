import OLMap from "ol/Map.js";
import View from "ol/View.js";
import Projection from "ol/proj/Projection.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import { Fill, Stroke, Style } from "ol/style.js";
import { ScaleLine } from "ol/control.js";
import { defaults as defaultInteractions } from "ol/interaction/defaults.js";
import { mapSpace, type MapDescriptor, type MapReader } from "@atlas/map";
import { PublishedMapLayers } from "./PublishedMapLayers";
import { PublishedVectors } from "./PublishedVectors";
import { drawSheet } from "./drawnSheet";

export function createPublishedMap(
  target: HTMLElement,
  descriptor: MapDescriptor,
  reader: MapReader,
  spaceId = descriptor.primarySpaceId,
  pixelRatio = globalThis.devicePixelRatio ?? 1
) {
  const space = mapSpace(descriptor, spaceId),
    extent = space.bounds;
  const wrapX = space.periodicWidth !== null;
  const projection = new Projection({
    code: space.id,
    units: "m",
    metersPerUnit: space.metresPerUnit,
    extent,
    global: wrapX,
  });
  const rasters = new PublishedMapLayers(reader, descriptor, projection, spaceId);
  const vectors = new PublishedVectors(descriptor, wrapX);
  const selection = selectionLayer(wrapX);
  const drawing = new VectorLayer({
    source: new VectorSource({ wrapX }),
    visible: false,
    declutter: true,
  });
  const furniture = sheetFurniture();
  const mask = new VectorLayer({ source: new VectorSource({ wrapX }), visible: false });
  target.tabIndex = 0;
  const map = new OLMap({
    target,
    pixelRatio,
    interactions: defaultInteractions({ doubleClickZoom: false }),
    layers: [rasters.base, drawing, rasters.overlays, vectors.group, mask, selection, furniture],
    view: new View({
      projection,
      multiWorld: wrapX,
      ...(wrapX
        ? { extent: [-Infinity, extent[1], Infinity, extent[3]], constrainOnlyCenter: true }
        : {}),
      center: [
        (descriptor.bounds[0] + descriptor.bounds[2]) / 2,
        (descriptor.bounds[1] + descriptor.bounds[3]) / 2,
      ],
      resolution: (descriptor.bounds[2] - descriptor.bounds[0]) / 800,
    }),
  });
  const scale = new ScaleLine({ units: "metric", bar: !!descriptor.realScale });
  map.addControl(scale);
  const close = () => {
    rasters.close();
    vectors.close();
    map.setTarget(undefined);
    map.dispose();
  };
  return {
    map,
    target,
    descriptor,
    space,
    rasters,
    vectors,
    selection,
    drawing,
    furniture,
    mask,
    scale,
    close,
  };
}
export type PublishedMapEngine = ReturnType<typeof createPublishedMap>;

function sheetFurniture() {
  const furniture = new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    visible: false,
    className: "cartographic-sheet",
  });
  furniture.on("postrender", (event) => {
    const sheet = furniture.get("sheet");
    if (sheet) drawSheet(event, sheet);
  });
  return furniture;
}
function selectionLayer(wrapX: boolean) {
  return new VectorLayer({
    source: new VectorSource({ wrapX }),
    style: new Style({
      stroke: new Stroke({ color: "#f8d589", width: 3, lineDash: [8, 5] }),
      fill: new Fill({ color: "#f8d58933" }),
    }),
  });
}
