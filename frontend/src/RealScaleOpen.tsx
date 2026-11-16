import { useState } from "react";
import type { Inspection, MapDescriptor, RegionSelection } from "@atlas/map";
import type { HexSize, RealScaleChoice } from "@atlas/context";
import { formatDistance, hexSizes, mapSizes, pointSelection, realScaleFrame } from "./realScale";

interface Props {
  map: MapDescriptor;
  inspection: Inspection;
  open(selection: RegionSelection, choice: RealScaleChoice, name: string): void;
}
/** Opens a real-scale child map centred on the inspected place (ADR 0016). */
export function RealScaleOpen({ map, inspection, open }: Props) {
  const [choice, setChoice] = useState<RealScaleChoice>({
    kind: "ground",
    hexSize: map.realScale ? "1.5m" : "100m",
    hexesAcross: 50,
  });
  const [name, setName] = useState("");
  const frame = realScaleFrame(choice);
  return (
    <details>
      <summary>Open a real-scale map here</summary>
      <label>
        Map name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Kind
        <select
          aria-label="Kind"
          value={choice.kind}
          onChange={(event) =>
            setChoice({ ...choice, kind: event.target.value as RealScaleChoice["kind"] })
          }
        >
          <option value="ground">Ground: outdoors, caves, towns</option>
          <option value="structure">Building floors</option>
        </select>
      </label>
      <label>
        Hex size
        <select
          aria-label="Hex size"
          value={choice.hexSize}
          onChange={(event) => setChoice({ ...choice, hexSize: event.target.value as HexSize })}
        >
          {hexSizes.map((size) => (
            <option key={size.value} value={size.value}>
              {size.metres} m ({size.feet} ft) · {size.use}
            </option>
          ))}
        </select>
      </label>
      <label>
        Size
        <select
          aria-label="Size"
          value={choice.hexesAcross}
          onChange={(event) => setChoice({ ...choice, hexesAcross: Number(event.target.value) })}
        >
          {mapSizes.map((size) => (
            <option key={size.hexesAcross} value={size.hexesAcross}>
              {size.label}: {size.hexesAcross} hexes across
            </option>
          ))}
        </select>
      </label>
      <p>
        {formatDistance(frame.width, "metres")} × {formatDistance(frame.height, "metres")}, centred
        here.
      </p>
      <button
        type="button"
        disabled={!name.trim()}
        onClick={() =>
          open(pointSelection(map, inspection.spaceId, inspection.position), choice, name.trim())
        }
      >
        Set up real-scale map
      </button>
    </details>
  );
}
