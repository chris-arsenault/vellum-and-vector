import type { Position } from "./types";

export function FrameFields({
  origin,
  floorLabel = "Floor / level",
}: {
  origin: Position;
  floorLabel?: string;
}) {
  return (
    <>
      <div className="form-row">
        <label>
          East · m<input name="x" type="number" defaultValue={origin.x} required />
        </label>
        <label>
          North · m<input name="y" type="number" defaultValue={origin.y} required />
        </label>
      </div>
      <div className="form-row">
        <label>
          Elevation · m<input name="z" type="number" defaultValue={origin.z} step="any" />
        </label>
        <label>
          Rotation · °<input name="rotation" type="number" defaultValue="0" step="any" />
        </label>
      </div>
      <label>
        {floorLabel}
        <input name="floor" placeholder="Optional, e.g. ground floor" />
      </label>
    </>
  );
}
export function ElevationFields({ z }: { z: number }) {
  return (
    <>
      <div className="form-row">
        <label>
          Elevation · m<input name="elevation" type="number" defaultValue={z} step="any" />
        </label>
        <label>
          Rotation · °<input name="rotation" type="number" defaultValue="0" step="any" />
        </label>
      </div>
      <label>
        Floor / level
        <input name="floor" placeholder="Optional, e.g. cellar" />
      </label>
    </>
  );
}
