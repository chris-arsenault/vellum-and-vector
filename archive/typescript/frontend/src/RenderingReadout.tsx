import { useSyncExternalStore } from "react";
import { renderingDiagnostics, type Summary } from "./renderingDiagnostics";

const milliseconds = ({ median, slowest }: Summary) =>
  `${Math.round(median)} ms typical, ${Math.round(slowest)} ms slowest`;

/**
 * How the map's tiles are being drawn right now: what the tile workers are doing, what a tile
 * costs and how often loaded tiles are thrown away. Read it off while the map feels slow.
 */
export function RenderingReadout() {
  const live = useSyncExternalStore(renderingDiagnostics.subscribe, renderingDiagnostics.snapshot);
  return (
    <details className="map-control-group">
      <summary>Rendering diagnostics</summary>
      <dl className="rendering-readout" aria-label="Rendering diagnostics">
        <dt>Tile workers</dt>
        <dd>{live.workers}</dd>
        <dt>Tiles waiting</dt>
        <dd>{live.waiting}</dd>
        <dt>Tiles drawn</dt>
        <dd>
          {live.drawn} of {live.requested} asked for; {live.cancelled} cancelled, {live.failed}{" "}
          failed
        </dd>
        <dt>Tile reloads</dt>
        <dd>{live.reloads}</dd>
        <dt>Raster inputs opened</dt>
        <dd>{live.registrations}</dd>
        <dt>Sampling a tile</dt>
        <dd>{milliseconds(live.sample)}</dd>
        <dt>Reading its sea and lakes</dt>
        <dd>{milliseconds(live.geography)}</dd>
        <dt>Asked for to drawn</dt>
        <dd>{milliseconds(live.roundTrip)}</dd>
        <dt>Over</dt>
        <dd>the last {live.recent} tiles</dd>
      </dl>
      <button className="secondary" onClick={() => renderingDiagnostics.reset()}>
        Start counting again
      </button>
    </details>
  );
}
