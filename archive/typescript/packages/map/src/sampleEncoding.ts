import type { MapDescriptor, MapSample, RasterBand, JsonValue } from "./generated";

interface BandBinding {
  layerId: string;
  spaceId: string;
  band: RasterBand;
}
type Attribute = [number, JsonValue | null, (string | null)?];
export type StoredSample = Omit<MapSample, "footprint" | "attributes"> & {
  attributes: Attribute[];
};

/** Published layer order is immutable; appending a layer preserves all previous band ordinals. */
export class MapSampleEncoding {
  private bands: BandBinding[] = [];
  private ordinals = new Map<string, number>();
  constructor(map: MapDescriptor) {
    for (const layer of map.layers) {
      if (layer.source.kind === "vector") continue;
      for (const band of layer.source.data.bands) {
        this.ordinals.set(key(layer.id, band.id), this.bands.length);
        this.bands.push({ layerId: layer.id, spaceId: layer.spaceId, band });
      }
    }
  }
  encode(sample: MapSample): StoredSample {
    const { footprint: _footprint, attributes, ...record } = sample;
    void _footprint;
    return {
      ...record,
      attributes: attributes.map((attribute): Attribute => {
        const ordinal = this.ordinals.get(key(attribute.layerId, attribute.bandId));
        const binding = ordinal === undefined ? undefined : this.bands[ordinal];
        if (!binding || binding.spaceId !== sample.spaceId || binding.band.unit !== attribute.unit)
          throw new Error("Sample attributes must identify a published band and its unit.");
        const label = category(binding.band, attribute.value);
        return attribute.category === label
          ? [ordinal!, attribute.value]
          : [ordinal!, attribute.value, attribute.category];
      }),
    };
  }
  decode(record: StoredSample, footprint: MapSample["footprint"]): MapSample {
    return {
      ...record,
      footprint,
      attributes: record.attributes.map(([ordinal, value, label]) => {
        const binding = this.bands[ordinal];
        if (!binding) throw new Error("Stored sample refers to an absent map band.");
        return {
          layerId: binding.layerId,
          bandId: binding.band.id,
          unit: binding.band.unit,
          label: binding.band.name,
          display: binding.band.display,
          value,
          category: label === undefined ? category(binding.band, value) : label,
        };
      }),
    };
  }
}
const key = (layer: string, band: string) => JSON.stringify([layer, band]);
const category = (band: RasterBand, value: JsonValue | null) =>
  band.categories.find((entry) => entry.value === value)?.label ?? null;
