import { useState } from "react";
import type { MapDescriptor, RegionSelection } from "@atlas/map";
import type { CityChoice, RealScaleChoice } from "@atlas/context";
import type { PublishedFeature } from "./publishedAppearance";
import { citySelection, districtChoice, districtSelection } from "./cityMaps";

interface Props {
  map: MapDescriptor;
  feature: PublishedFeature;
  open(
    selection: RegionSelection,
    name: string,
    realScale?: RealScaleChoice,
    city?: CityChoice
  ): void;
}
/** Opens a settlement's city map, or one of a city map's districts as its own map. */
export function CityOpen({ map, feature, open }: Props) {
  const [name, setName] = useState(feature.name);
  const city = citySelection(map, feature);
  const district = districtSelection(map, feature);
  if (!city && !district) return null;
  return (
    <div className="city-refinement-action">
      <label>
        Map name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button
        className="primary"
        type="button"
        disabled={!name.trim()}
        onClick={() => {
          if (city) open(city.selection, name.trim(), undefined, city.city);
          else if (district) open(district, name.trim(), districtChoice);
        }}
      >
        {city ? "Generate city map" : "Generate district map"}
      </button>
    </div>
  );
}
