import { atlasQuality, defaultTerrainCells, generationWorkload } from "@atlas/generation";
import type { Profile } from "@atlas/domain";

interface Props {
  width: number;
  height: number;
  quality: string;
  profile?: Profile;
  showWarning?: boolean;
}
const areaFormat = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 10 });

function resolutionChoices({ width, height, profile = "world" }: Omit<Props, "quality">) {
  return Object.keys(atlasQuality).map((quality) => {
    const estimate = generationWorkload(width, height, quality, profile);
    return {
      quality,
      label: `${quality[0].toUpperCase()}${quality.slice(1)} · ${areaFormat(estimate.cellAreaKm2)} km²/cell · ≈${estimate.cells.toLocaleString()} cells`,
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

export function GenerationWorkload({
  width,
  height,
  quality,
  profile = "world",
  showWarning = true,
}: Props) {
  const estimate = generationWorkload(width, height, quality, profile);
  return (
    <div className="generation-workload" data-cell-count={estimate.cells}>
      <p role="status">
        {areaFormat(estimate.cellAreaKm2)} km² per terrain cell · approximately{" "}
        {estimate.cells.toLocaleString()} cells. Boundary support and authored detail can add cells.
      </p>
      {showWarning && estimate.aboveDefault && (
        <p className="warning" role="alert">
          Above the default workload of {defaultTerrainCells.toLocaleString()} cells. Generation
          will be slower and may run out of memory or crash this tab.
        </p>
      )}
    </div>
  );
}
