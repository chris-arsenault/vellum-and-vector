import { useState, type PointerEvent } from "react";
import type { Template } from "./types";
import { bounds } from "./presentation";
import { detached, editable, itemFromFeature, type Item, type Floor } from "./templateEditing";

export function useTemplateDrawing() {
  const [items, setItems] = useState<Item[]>([]);
  const [floors, setFloors] = useState<Floor[]>([{ id: detached, name: "Ground", z: 0 }]);
  const [floor, setFloor] = useState(detached);
  const [size, setSize] = useState({ width: 20, height: 15 });
  const [units, setUnits] = useState("metre");
  function load(template: Template) {
    const box = bounds(template.footprint);
    setSize({ width: box[2], height: box[3] });
    setItems(template.features.filter(editable).map(itemFromFeature));
    setUnits(template.units ?? "metre");
    setFloors([
      { id: detached, name: "Ground", z: 0 },
      ...(template.spaces ?? []).map((s) => ({ id: s.id, name: s.name, z: s.frame.origin.z })),
    ]);
    setFloor(detached);
  }
  return {
    items,
    setItems,
    floors,
    setFloors,
    floor,
    setFloor,
    size,
    setSize,
    units,
    setUnits,
    load,
  };
}
type Studio = ReturnType<typeof useTemplateDrawing>;
export function TemplateDrawing({ studio, existing }: { studio: Studio; existing: boolean }) {
  const [tool, setTool] = useState("room");
  const [start, setStart] = useState<number[] | null>(null);
  const { size, items, floor } = studio;
  function point(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - box.left) / box.width) * size.width,
      (1 - (event.clientY - box.top) / box.height) * size.height,
    ];
  }
  return (
    <>
      <DrawingSize studio={studio} existing={existing} />
      <DrawingFloors studio={studio} />
      <label>
        Draw
        <select value={tool} onChange={(e) => setTool(e.target.value)}>
          <option value="room">Room · drag rectangle</option>
          <option value="door">Door · click a room wall</option>
          <option value="furniture">Furniture · click inside room</option>
          <option value="stairs">Stairs · align between floors</option>
        </select>
      </label>
      <svg
        className="template-canvas"
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="img"
        aria-label="Template room drawing canvas"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setStart(point(e));
        }}
        onPointerUp={(e) => {
          if (start) {
            const item = drawnItem(tool, start, point(e), items, floor);
            if (item) studio.setItems([...items, item]);
          }
          setStart(null);
        }}
      >
        <rect width={size.width} height={size.height} fill="#ddcfaa" />
        {items
          .filter((i) => i.space === floor)
          .map((item) => (
            <DrawingItem key={item.id} item={item} height={size.height} />
          ))}
      </svg>
      <button className="quiet" onClick={() => studio.setItems(items.slice(0, -1))}>
        Undo shape
      </button>
    </>
  );
}
function DrawingSize({ studio, existing }: { studio: Studio; existing: boolean }) {
  return (
    <>
      <div className="form-row">
        {(["width", "height"] as const).map((axis) => (
          <label key={axis}>
            {axis === "width" ? "Width" : "Height"}
            <input
              type="number"
              min="1"
              disabled={existing}
              value={studio.size[axis]}
              onChange={(e) => studio.setSize({ ...studio.size, [axis]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      <label>
        Units
        <select value={studio.units} onChange={(e) => studio.setUnits(e.target.value)}>
          <option value="metre">Metres</option>
          <option value="foot">Feet</option>
        </select>
      </label>
    </>
  );
}
function DrawingFloors({ studio }: { studio: Studio }) {
  const floor = studio.floors.find((f) => f.id === studio.floor)!;
  return (
    <>
      <label>
        Floor
        <select value={studio.floor} onChange={(e) => studio.setFloor(e.target.value)}>
          {studio.floors.map((f) => (
            <option value={f.id} key={f.id}>
              {f.name} · {f.z}
            </option>
          ))}
        </select>
      </label>
      {floor.id !== detached && (
        <label>
          Floor elevation · local units
          <input
            type="number"
            step="any"
            value={floor.z}
            onChange={(e) =>
              studio.setFloors(
                studio.floors.map((f) =>
                  f.id === floor.id ? { ...f, z: Number(e.target.value) } : f
                )
              )
            }
          />
        </label>
      )}
      <button
        className="quiet"
        onClick={() => {
          const f = {
            id: crypto.randomUUID(),
            name: `Floor ${studio.floors.length + 1}`,
            z: studio.floors.length * (studio.units === "foot" ? 10 : 3),
          };
          studio.setFloors([...studio.floors, f]);
          studio.setFloor(f.id);
        }}
      >
        Add floor
      </button>
    </>
  );
}
function DrawingItem({ item, height }: { item: Item; height: number }) {
  if (item.original?.geometry.type === "Polygon")
    return (
      <path
        d={item.original.geometry.coordinates
          .map(
            (ring) => ring.map((p, i) => `${i ? "L" : "M"}${p[0]},${height - p[1]}`).join(" ") + "Z"
          )
          .join(" ")}
        fillRule="evenodd"
        fill="#f4e9ce"
        stroke="#6d7567"
        strokeWidth=".12"
      />
    );
  if (["door", "stairs"].includes(item.kind))
    return (
      <circle
        cx={item.x}
        cy={height - item.y}
        r=".3"
        fill={item.kind === "door" ? "#378b65" : "#515fa0"}
      />
    );
  return (
    <rect
      x={item.x}
      y={height - item.y - item.height}
      width={item.width}
      height={item.height}
      fill={item.kind === "room" ? "#f4e9ce" : "#a88754"}
      stroke="#6d7567"
      strokeWidth=".12"
    />
  );
}
function drawnItem(
  tool: string,
  start: number[],
  end: number[],
  items: Item[],
  floor: string
): Item | null {
  let [x, y, width, height] = [
    Math.min(start[0], end[0]),
    Math.min(start[1], end[1]),
    Math.abs(start[0] - end[0]),
    Math.abs(start[1] - end[1]),
  ];
  if (tool === "door") {
    const edge = doorPoint(items, floor, end);
    if (!edge) return null;
    [x, y] = edge;
    width = height = 0;
  }
  if (tool === "stairs") {
    const peer = items.find(
      (i) => i.kind === "stairs" && i.space !== floor && Math.hypot(i.x - end[0], i.y - end[1]) < 1
    );
    [x, y] = peer ? [peer.x, peer.y] : end;
    width = height = 0;
  }
  if (tool === "furniture") [x, y, width, height] = [end[0], end[1], 1.2, 0.7];
  if (!["door", "stairs"].includes(tool) && (width <= 0.1 || height <= 0.1)) return null;
  return {
    id: crypto.randomUUID(),
    name: `${tool} ${items.length + 1}`,
    kind: tool,
    x,
    y,
    width,
    height,
    space: floor,
  };
}
function doorPoint(items: Item[], floor: string, end: number[]) {
  return items
    .filter((i) => i.kind === "room" && i.space === floor)
    .flatMap((i) => [
      [i.x, Math.max(i.y, Math.min(i.y + i.height, end[1]))],
      [i.x + i.width, Math.max(i.y, Math.min(i.y + i.height, end[1]))],
      [Math.max(i.x, Math.min(i.x + i.width, end[0])), i.y],
      [Math.max(i.x, Math.min(i.x + i.width, end[0])), i.y + i.height],
    ])
    .sort(
      (a, b) => Math.hypot(a[0] - end[0], a[1] - end[1]) - Math.hypot(b[0] - end[0], b[1] - end[1])
    )[0];
}
