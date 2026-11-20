import { useEffect, useRef } from "react";
import type { MapDescriptor } from "@atlas/map";
import { menuKeyboard } from "./menuKeyboard";
import { inspectionWords as words } from "./inspectionText";
import type { PointChoice, PointPick } from "./usePointPick";

/** Lists everything under a clicked point; choosing one shows only that item's details. */
export function PointPickMenu({
  map,
  pick,
  choose,
  cancel,
}: {
  map: MapDescriptor;
  pick: PointPick | null;
  choose(pick: PointPick, choice: PointChoice): void;
  cancel(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = menu.current!;
    if (!pick) {
      if (element.matches(":popover-open")) element.hidePopover();
      return;
    }
    element.style.left = `${Math.max(4, Math.min(pick.at.x, window.innerWidth - 290))}px`;
    element.style.top = `${Math.max(4, Math.min(pick.at.y, window.innerHeight - 320))}px`;
    element.showPopover();
    element.querySelector<HTMLButtonElement>("button:enabled")?.focus();
  }, [pick]);
  const take = (choice: PointChoice) => {
    menu.current?.hidePopover();
    choose(pick!, choice);
  };
  return (
    <div
      ref={menu}
      popover="auto"
      className="point-pick-menu"
      role="menu"
      tabIndex={-1}
      aria-label="At this point"
      onKeyDown={menuKeyboard}
      onToggle={(event) => {
        if ((event.nativeEvent as ToggleEvent).newState === "closed") cancel();
      }}
    >
      {pick?.inspection.features.map((feature) => (
        <button key={feature.id} role="menuitem" onClick={() => take({ feature })}>
          <strong>{feature.name || words(feature.kind)}</strong>
          <small>
            {words(feature.kind)} ·{" "}
            {map.layers.find((layer) => layer.id === feature.layerId)?.name ?? feature.layerId}
          </small>
        </button>
      ))}
      {pick && (
        <button role="menuitem" onClick={() => take({ substrate: true })}>
          <strong>Numerical substrate</strong>
          <small>Stored values for the cell here</small>
        </button>
      )}
    </div>
  );
}
