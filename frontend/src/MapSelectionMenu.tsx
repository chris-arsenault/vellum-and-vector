import { useEffect, useRef, type ReactNode } from "react";
import { menuKeyboard } from "./menuKeyboard";

function useSelectionContext(selected: boolean, clear: () => void) {
  const surface = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = surface.current!;
    const open = (x: number, y: number) => {
      const element = menu.current!;
      element.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 230))}px`;
      element.style.top = `${Math.max(4, Math.min(y, window.innerHeight - 130))}px`;
      element.showPopover();
      element.querySelector<HTMLButtonElement>("button:enabled")?.focus();
    };
    const context = (event: MouseEvent) => {
      if (!selected) return;
      event.preventDefault();
      open(event.clientX, event.clientY);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (menu.current?.contains(event.target as Node)) return;
      if (event.key === "Escape") clear();
      if (selected && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
        event.preventDefault();
        const box = root.getBoundingClientRect();
        open(box.x + box.width / 2, box.y + box.height / 2);
      }
    };
    root.addEventListener("contextmenu", context);
    root.addEventListener("keydown", keyboard);
    return () => {
      root.removeEventListener("contextmenu", context);
      root.removeEventListener("keydown", keyboard);
    };
  }, [selected, clear]);
  return { surface, menu };
}

// owner-direction(2026-11-17): right-click a selection to refine it
export function MapSelectionMenu({
  children,
  refine,
  properties,
  clear,
  selected,
  refinable,
}: {
  children: ReactNode;
  refine(): void;
  properties(): void;
  clear(): void;
  selected: boolean;
  refinable: boolean;
}) {
  const { surface, menu } = useSelectionContext(selected, clear);
  const act = (action: () => void) => {
    menu.current?.hidePopover();
    action();
  };
  return (
    <div
      className="selection-surface"
      role="group"
      aria-label="Map selection surface"
      ref={surface}
    >
      {children}
      <div
        ref={menu}
        popover="auto"
        className="selection-context-menu"
        role="menu"
        tabIndex={-1}
        aria-label="Selection actions"
        onKeyDown={menuKeyboard}
      >
        <button role="menuitem" disabled={!refinable} onClick={() => act(refine)}>
          Refine this selection
        </button>
        <button role="menuitem" onClick={() => act(properties)}>
          Selection properties
        </button>
        <button role="menuitem" onClick={() => act(clear)}>
          Clear selection
        </button>
      </div>
    </div>
  );
}
