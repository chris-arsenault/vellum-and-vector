import type { RasterPresentation } from "./types";
const baseLabels = { surface: "Surface", topographic: "Topographic", relief: "Relief" } as const;
export function BaseMapChoices({
  view,
  change,
  edit,
}: {
  view: RasterPresentation;
  change(base: RasterPresentation["base"]): void;
  edit(): void;
}) {
  return (
    <fieldset className="base-choices">
      <legend>Base map</legend>
      <div className="base-grid">
        {(["surface", "topographic", "relief"] as const).map((base) => (
          <label className={`base-choice ${base}`} key={base}>
            <input
              type="radio"
              name="base-map"
              aria-label={baseLabels[base]}
              checked={view.base === base}
              onChange={() => change(base)}
            />
            <svg className="base-preview" viewBox="0 0 140 72" aria-hidden="true">
              <path className="preview-water" d="M0 0H140V72H0Z" />
              <path className="preview-land" d="M0 0H120Q78 22 108 35T60 72H0Z" />
              <path
                className="preview-hill"
                d="M-10 62Q28 2 62 22T99 8M-5 76Q30 14 58 35T91 25M-12 88Q35 25 56 48T84 41"
              />
              <path className="preview-river" d="M22 0Q15 20 45 33T70 69" />
            </svg>
            <span>{baseLabels[base]}</span>
          </label>
        ))}
        <button
          className="quiet terrain-style"
          aria-label="Adjust terrain appearance"
          title="Adjust terrain appearance"
          onClick={edit}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M2 4H14M2 8H14M2 12H14M5 2V6M11 6V10M7 10V14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
      </div>
    </fieldset>
  );
}
