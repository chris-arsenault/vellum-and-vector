import { areaPath, chartFrame, compact, linePath, project, type Series } from "./surfaceData";

const width = 100;

/**
 * Several series over one axis as a small SVG: the first series is filled, the rest are
 * lines. The drawing scales to the panel; strokes keep their width. Axis ends and the
 * maximum are labelled, nothing else, so the shape is what reads.
 */
export function TrendChart({
  series,
  height = 44,
  xLabel = (x) => String(Math.round(x)),
  yLabel = compact,
  label,
}: {
  series: Series[];
  height?: number;
  xLabel?: (x: number) => string;
  yLabel?: (y: number) => string;
  label: string;
}) {
  const drawn = series.filter((s) => s.points.length);
  const frame = chartFrame(drawn, width, height);
  if (!frame) return <p className="surface-empty">{label}: no record yet</p>;
  return (
    <figure className="trend">
      <span className="trend-max">{yLabel(frame.yMax)}</span>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        {drawn.map((s, i) => (
          <g key={s.id} className={`series series-${i}`}>
            {i === 0 && <path className="series-area" d={areaPath(frame, s)} />}
            <path className="series-line" d={linePath(frame, s)} vectorEffect="non-scaling-stroke">
              <title>{s.label}</title>
            </path>
            <Marker frame={frame} series={s} />
          </g>
        ))}
      </svg>
      <div className="trend-axis">
        <span>{xLabel(frame.xMin)}</span>
        <span>{xLabel(frame.xMax)}</span>
      </div>
      <figcaption className="legend">
        {drawn.map((s, i) => (
          <span key={s.id}>
            <i className={`swatch series-${i}`} />
            {s.label} {yLabel(s.points[s.points.length - 1].y)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
/** The last point of a series, drawn as a short vertical tick so it survives non-uniform scaling. */
function Marker({
  frame,
  series,
}: {
  frame: NonNullable<ReturnType<typeof chartFrame>>;
  series: Series;
}) {
  const last = project(frame, series.points[series.points.length - 1]);
  return (
    <line
      className="series-mark"
      x1={last.x}
      x2={last.x}
      y1={Math.max(0, last.y - 2)}
      y2={Math.min(frame.height, last.y + 2)}
      vectorEffect="non-scaling-stroke"
    />
  );
}
