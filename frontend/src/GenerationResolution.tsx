export interface Resolution {
  quality: string;
  cellAreaKm2: number;
  cells: number;
  aboveDefault: boolean;
}

interface Props {
  quality: string;
  showWarning?: boolean;
  resolutions?: Resolution[];
}
const areaFormat = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 10 });

function resolutionChoices({ resolutions }: Omit<Props, "quality">) {
  return ["draft", "standard", "fine"].map((quality) => {
    const estimate = resolutions?.find((entry) => entry.quality === quality);
    return {
      quality,
      label: `${quality[0].toUpperCase()}${quality.slice(1)}${estimate ? ` · ${areaFormat(estimate.cellAreaKm2)} km²/cell · ≈${estimate.cells.toLocaleString()} cells` : ""}`,
    };
  });
}

export function GenerationResolution(
  props: Props & { disabled?: boolean; change(quality: string): void }
) {
  return (
    <>
      <label>
        Detail level
        <select
          name="quality"
          aria-label="Detail level"
          value={props.quality}
          disabled={props.disabled}
          onChange={(event) => props.change(event.target.value)}
        >
          {resolutionChoices(props).map(({ quality, label }) => (
            <option key={quality} value={quality}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {!props.disabled && <GenerationWorkload {...props} />}
    </>
  );
}

export function GenerationWorkload({ resolutions, quality, showWarning = true }: Props) {
  const estimate = resolutions?.find((entry) => entry.quality === quality);
  if (!estimate) return null;
  return (
    <div className="generation-workload" data-cell-count={estimate.cells}>
      <p role="status">
        {areaFormat(estimate.cellAreaKm2)} km² per terrain cell · approximately{" "}
        {estimate.cells.toLocaleString()} cells. Boundary support and authored detail can add cells.
      </p>
      {showWarning && estimate.aboveDefault && (
        <p className="warning" role="alert">
          Above the default workload of 60,000 cells. Generation will require more time and memory.
        </p>
      )}
    </div>
  );
}
