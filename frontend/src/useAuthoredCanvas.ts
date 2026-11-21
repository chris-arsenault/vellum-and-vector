import { useEffect, useState } from "react";
import { unByKey } from "ol/Observable.js";
import type { PublishedMapView } from "./PublishedMapView";

/** What an authored map's canvas does beyond a finished map's: reload the terrain raster
 * after each terrain rewrite (`stamp` counts them) and read the height under the pointer. */
export function useAuthoredCanvas(viewer: PublishedMapView | null, stamp: number | undefined) {
  const [elevation, setElevation] = useState("");
  const authored = stamp !== undefined;
  useEffect(() => {
    if (viewer && stamp) void viewer.reloadTerrain();
  }, [viewer, stamp]);
  useEffect(() => {
    if (!viewer || !authored) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const move = viewer.engine.map.on("pointermove", (event) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        request?.abort();
        request = new AbortController();
        const [x, y] = event.coordinate;
        viewer
          .elevationAt(x, y, request.signal)
          .then((height) => setElevation(height === null ? "" : `${Math.round(height)} m`))
          .catch(() => {});
      }, 120);
    });
    return () => {
      clearTimeout(timer);
      request?.abort();
      unByKey(move);
    };
  }, [viewer, authored]);
  return elevation;
}
