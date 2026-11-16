import { useState } from "react";
import { editActions, type ActionContext } from "./realScaleActions";

/** Search editing commands by name; the list doubles as the shortcut sheet. */
export function RealScaleCommandPalette({
  context,
  close,
}: {
  context: ActionContext;
  close(): void;
}) {
  const [query, setQuery] = useState("");
  const shown = editActions.filter((action) =>
    action.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const run = (index: number) => {
    const action = shown[index];
    if (!action || action.blocked(context)) return;
    close();
    void action.run(context);
  };
  return (
    <div role="dialog" aria-label="Commands" className="command-palette">
      <label>
        Search commands
        <input
          ref={(input) => input?.focus()}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") run(shown.findIndex((action) => !action.blocked(context)));
            if (event.key === "Escape") close();
          }}
        />
      </label>
      <ul>
        {shown.map((action, index) => {
          const blocked = action.blocked(context);
          return (
            <li key={action.id}>
              <button disabled={!!blocked} title={blocked ?? undefined} onClick={() => run(index)}>
                {action.name} <kbd>{action.shortcut}</kbd>
              </button>
            </li>
          );
        })}
      </ul>
      <button onClick={close}>Close commands</button>
    </div>
  );
}
