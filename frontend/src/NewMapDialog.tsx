import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthoredProfile, MapEditing, MapRef } from "@atlas/map";
import { ErrorMessage } from "./ErrorMessage";
import { frameUnit, levels, newMapRequest } from "./newMap";
import "./authoredEditor.css";

interface Props {
  editing: MapEditing;
  /** Open the new map; the editor starts with the edit tool in hand. */
  open(reference: MapRef): void;
  close(): void;
}
interface Form {
  name: string;
  profile: AuthoredProfile;
  width: string;
  height: string;
}
function LevelPicker({ form, change }: { form: Form; change(next: Partial<Form>): void }) {
  return (
    <fieldset className="new-map-levels">
      <legend>Level</legend>
      {levels.map((level) => (
        <label key={level.id} data-checked={form.profile === level.id}>
          <input
            type="radio"
            name="level"
            checked={form.profile === level.id}
            onChange={() => change({ profile: level.id })}
          />
          <strong>{level.label}</strong>
          <span>{level.hint}</span>
        </label>
      ))}
    </fieldset>
  );
}
function Frame({ form, change }: { form: Form; change(next: Partial<Form>): void }) {
  const unit = frameUnit(form.profile);
  return (
    <div className="new-map-frame">
      {(["width", "height"] as const).map((side) => (
        <label key={side}>
          {side === "width" ? "Width" : "Height"} ({unit})
          <input
            inputMode="decimal"
            value={form[side]}
            placeholder="Default"
            onChange={(event) => change({ [side]: event.target.value })}
          />
        </label>
      ))}
    </div>
  );
}
/** Start a blank, all-ocean map to draw by hand: no generation runs (ADR 0019). */
export function NewMapDialog({ editing, open, close }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const name = useRef<HTMLInputElement>(null);
  const cache = useQueryClient();
  const [form, setForm] = useState<Form>({ name: "", profile: "world", width: "", height: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    name.current?.focus();
    return () => element.close();
  }, []);
  const change = (next: Partial<Form>) => {
    setProblem(null);
    setForm((held) => ({ ...held, ...next }));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const request = newMapRequest(form);
    if (typeof request === "string") return setProblem(new Error(request));
    setBusy(true);
    try {
      const reference = await editing.newMap(request);
      await cache.invalidateQueries({ queryKey: ["stored-contexts"] });
      open(reference);
    } catch (failure) {
      setProblem(failure);
      setBusy(false);
    }
  };
  return (
    <dialog ref={dialog} className="new-map-dialog" aria-label="New map" onCancel={close}>
      <form onSubmit={(event) => void submit(event)}>
        <h2>New map</h2>
        <p className="new-map-lede">
          Starts as open ocean. You draw the coasts, the relief and the places by hand.
        </p>
        <label className="new-map-name">
          Name
          <input
            ref={name}
            value={form.name}
            placeholder="The Shattered Reach"
            onChange={(event) => change({ name: event.target.value })}
          />
        </label>
        <LevelPicker form={form} change={change} />
        <Frame form={form} change={change} />
        <ErrorMessage error={problem} />
        <div className="new-map-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Creating…" : "Create map"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
