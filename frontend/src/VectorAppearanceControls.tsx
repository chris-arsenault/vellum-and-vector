import type { LayerStyle } from "./types";
import { defaultSymbolStyle } from "./vectorStyles";
import type { Symbolizer } from "geostyler-style";
import type { Geometry } from "geojson";
interface Context {
  name: string;
  presentation: LayerStyle;
  kinds: Geometry["type"][];
  mode: "raster" | "drawn";
  update(changes: Partial<LayerStyle>): void;
  advanced(): void;
}
function sizeSymbol(symbol: Symbolizer, size: number): Symbolizer {
  if (symbol.kind === "Line") return { ...symbol, width: size };
  if (symbol.kind === "Fill") return { ...symbol, outlineWidth: size };
  if (symbol.kind === "Mark") return { ...symbol, radius: size };
  return symbol;
}
function sizeControl(symbol: Symbolizer | undefined) {
  if (symbol?.kind === "Mark")
    return { label: "Point radius", value: typeof symbol.radius === "number" ? symbol.radius : 5 };
  if (symbol?.kind === "Fill")
    return {
      label: "Outline width",
      value: typeof symbol.outlineWidth === "number" ? symbol.outlineWidth : 2,
    };
  if (symbol?.kind === "Line")
    return { label: "Line width", value: typeof symbol.width === "number" ? symbol.width : 2 };
  return { label: "Line width", value: 2 };
}
function defaultSymbols({ name, presentation, kinds }: Context) {
  return presentation.symbols ?? defaultSymbolStyle(name, presentation, kinds);
}

function symbolActions(context: Context) {
  const { presentation, update } = context;
  const symbols = () => defaultSymbols(context);
  return {
    update,
    color: (color: string) =>
      update({
        color,
        symbols: presentation.symbols
          ? {
              ...presentation.symbols,
              rules: presentation.symbols.rules.map((r) => ({
                ...r,
                symbolizers: r.symbolizers.map((s) => ({ ...s, color })),
              })),
            }
          : undefined,
      }),
    width: (width: number) => {
      if (!(width > 0)) return;
      const next = symbols();
      update({
        symbols: {
          ...next,
          rules: next.rules.map((r) => ({
            ...r,
            symbolizers: r.symbolizers.map((s) => sizeSymbol(s, width)),
          })),
        },
      });
    },
    labels: (labels: boolean) => {
      const next = presentation.symbols;
      update({
        labels,
        symbols: next
          ? {
              ...next,
              rules: next.rules.map((r) => ({
                ...r,
                symbolizers: labels
                  ? [
                      ...r.symbolizers.filter((s) => s.kind !== "Text"),
                      {
                        kind: "Text" as const,
                        label: "{{name}}",
                        color: presentation.color,
                        size: 12,
                      },
                    ]
                  : r.symbolizers.filter((s) => s.kind !== "Text"),
              })),
            }
          : undefined,
      });
    },
  };
}
export function VectorAppearanceControls(context: Context) {
  const { name, presentation, advanced, mode } = context;
  const actions = symbolActions(context);
  const line = defaultSymbols(context)
    .rules.flatMap((r) => r.symbolizers)
    .find((s) => ["Line", "Fill", "Mark"].includes(s.kind));
  const size = sizeControl(line);
  return (
    <section className="vector-appearance" aria-label={`Appearance ${name}`}>
      <h3>{name}</h3>
      {mode === "raster" && (
        <div className="appearance-grid">
          <label>
            Color
            <input
              type="color"
              value={presentation.color}
              onChange={(e) => actions.color(e.target.value)}
            />
          </label>
          <label>
            {size.label}
            <input
              type="number"
              min="0.1"
              max="40"
              step="0.1"
              value={size.value}
              onChange={(e) => actions.width(Number(e.target.value))}
            />
          </label>
        </div>
      )}
      <label>
        Opacity
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={presentation.opacity}
          onChange={(e) => actions.update({ opacity: Number(e.target.value) })}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={presentation.labels ?? false}
          onChange={(e) => actions.labels(e.target.checked)}
        />
        Labels
      </label>
      {mode === "raster" && (
        <>
          <button className="secondary" onClick={advanced}>
            Advanced symbol rules
          </button>
          <button className="quiet" onClick={() => actions.update({ symbols: undefined })}>
            Reset symbols
          </button>
        </>
      )}
    </section>
  );
}
