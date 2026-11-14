import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ErrorMessage } from "./ErrorMessage";
import type { CartographicPresentation } from "./types";

export function SheetControls({
  name,
  sheet,
  update,
  download,
}: {
  name: string;
  sheet: CartographicPresentation["sheet"];
  update(change: Partial<CartographicPresentation["sheet"]>): void;
  download(width: number, height: number): Promise<void>;
}) {
  const [width, setWidth] = useState(2400),
    [height, setHeight] = useState(1800);
  const exportSheet = useMutation({
    mutationFn: () => download(width, height),
  });
  return (
    <section className="drawn-sheet-panel" aria-label="Finished sheet">
      <h3>Sheet layout</h3>
      <p className="hint">Titles and decorations belong to this map view.</p>
      <label>
        Sheet title
        <input
          value={sheet.title}
          placeholder={name}
          onChange={(e) => update({ title: e.target.value })}
        />
      </label>
      <label>
        Sheet subtitle
        <input
          value={sheet.subtitle}
          placeholder="Region ancestry"
          onChange={(e) => update({ subtitle: e.target.value })}
        />
      </label>
      <SheetDecorations sheet={sheet} update={update} />
      <h3>Export PNG</h3>
      <div className="drawn-label-numbers">
        <label>
          Image width · px
          <input
            type="number"
            min="1"
            step="1"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
        <label>
          Image height · px
          <input
            type="number"
            min="1"
            step="1"
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </label>
      </div>
      <button disabled={exportSheet.isPending} onClick={() => exportSheet.mutate()}>
        {exportSheet.isPending ? "Drawing sheet…" : "Download map PNG"}
      </button>
      <ErrorMessage error={exportSheet.error} />
    </section>
  );
}
function SheetDecorations({
  sheet,
  update,
}: {
  sheet: CartographicPresentation["sheet"];
  update: (changes: Partial<CartographicPresentation["sheet"]>) => void;
}) {
  return (
    <fieldset className="sheet-decorations">
      <legend>Decorations</legend>
      {(["frame", "legend", "compass", "scale"] as const).map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={sheet[key]}
            onChange={(e) => update({ [key]: e.target.checked })}
          />
          {`Sheet ${key}`}
        </label>
      ))}
    </fieldset>
  );
}
