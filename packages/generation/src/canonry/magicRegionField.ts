import { preparedValue, rectangle, spatial, type MagicCondition } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { magicFieldDefinitions, type MagicChannel } from "./magicFieldDefinitions";
import type { PhysicalArrayName } from "./continuousState";
import { physicalSupport } from "./physicalSupport";
import { waterRegions } from "./landformField";
import { hashUnit } from "./noise";
import { unitNoiseField } from "./noiseField";
import {
  all,
  any,
  not,
  above,
  below,
  physicalScalar,
  regionShape,
  regionReader,
  type CausalRegion,
  type CausalScalar,
} from "./causalRegions";
import { riverRegion } from "./riverRegions";
import { categoryRegion } from "./categoryGeography";

const physical: Record<string, PhysicalArrayName> = {
  temperature: "Temperature",
  ice: "IceThickness",
  moisture: "Moisture",
  geothermal: "Geothermal",
  fracture: "FractureConductance",
  slope: "Slope",
  treeCover: "TreeCover",
  wetlandCover: "WetlandCover",
  peatCarbon: "PeatCarbon",
  oilCarbon: "OilCarbon",
  alteredCover: "AlteredCover",
  ecologicalAlteration: "EcologicalAlteration",
  ecologicalToxicity: "EcologicalToxicity",
  soilWater: "SoilWater",
  soilDepth: "SoilDepth",
  grazers: "Grazers",
  browsers: "Browsers",
};
const matches = (test: MagicCondition, value: number) =>
  value >= (test.min ?? -Infinity) &&
  value <= (test.max ?? Infinity) &&
  (!test.values || test.values.includes(value));

/** Share primitive regions across configured rules without fitting a membership field. */
export function magicRegionCompiler(state: GenerationState) {
  const { map, magic } = state.physical!,
    mesh = map.mesh,
    support = map.continuous?.support ?? physicalSupport(mesh);
  const conditions = new Map<string, CausalRegion>();
  const water = waterRegions(state);
  const scalar = (field: MagicField, key: string): CausalScalar => {
    let owner = field;
    if (key.startsWith("system:")) {
      const other = magic?.fields.find((candidate) => candidate.definition.id === key.slice(7));
      if (!other) return () => 0;
      owner = other;
      key = "intensity";
    }
    if (Object.hasOwn(magicFieldDefinitions, key)) {
      const name = key as MagicChannel;
      return preparedValue(support, owner[name], {
        coefficients: owner.coefficients?.[name],
        adaptive: owner.adaptive?.[name],
      });
    }
    if (physical[key]) return physicalScalar(state, physical[key]);
    if (key === "elevation") {
      return preparedValue(support, map.Elevation, {
        coefficients: map.continuous!.coefficients.Elevation,
        adaptive: map.continuous!.adaptive.Elevation,
        transform: { scale: 1 / 1024, offset: -map.BaseSeaLevel / 1024 },
      });
    }
    return () => 0;
  };
  const compile = (field: MagicField, test: MagicCondition): CausalRegion => {
    const id = `${field.definition.id}:${JSON.stringify(test)}`;
    const previous = conditions.get(id);
    if (previous !== undefined) return previous;
    let result: CausalRegion;
    if (test.field === "water")
      result = any(
        ...Object.entries(water)
          .filter(([code]) => matches(test, Number(code)))
          .map(([, region]) => region)
      );
    else if (test.field === "landform") {
      result = regionShape(categoryRegion(state, "landform", (code) => matches(test, code)));
    } else if (test.field === "biome") {
      result = regionShape(categoryRegion(state, "biome", (code) => matches(test, code)));
    } else if (test.field === "river") {
      const present = regionShape(riverRegion(state, (order) => matches(test, order)));
      result = matches(test, 0)
        ? any(present, not(regionShape(riverRegion(state, (order) => order > 0))))
        : present;
    } else if (test.field === "scatter") {
      const scale = field.definition.parameters.featureNoiseScale,
        bounds = mesh.bounds;
      const shapes = [];
      for (let y = Math.floor(bounds[1] / scale); y <= Math.floor(bounds[3] / scale); y++)
        for (let x = Math.floor(bounds[0] / scale); x <= Math.floor(bounds[2] / scale); x++)
          if (
            matches(
              test,
              hashUnit(
                (magic?.classificationSeed ?? state.domain.world.seed) ^ (test.salt ?? 0),
                x,
                y ^ (test.index ?? 0)
              )
            )
          )
            shapes.push(
              rectangle([
                x * scale + mesh.origin[0],
                y * scale + mesh.origin[1],
                (x + 1) * scale + mesh.origin[0],
                (y + 1) * scale + mesh.origin[1],
              ])
            );
      result = regionShape(shapes.length ? spatial.unionAll(shapes) : null);
    } else if (test.field === "firstEpoch" || test.field === "coastalFirstEpoch") {
      const occurrences = field.occurrences?.[test.field] ?? [];
      const known = any(...occurrences.map((entry) => regionShape(entry.footprint)));
      result = any(
        ...occurrences
          .filter((entry) => matches(test, entry.epoch))
          .map((entry) => regionShape(entry.footprint)),
        ...(matches(test, -1) ? [not(known)] : [])
      );
    } else {
      let read: CausalScalar;
      if (test.field === "noise") {
        const scale = field.definition.parameters.featureNoiseScale;
        read = unitNoiseField(mesh.origin, test.salt ?? 0x621d, scale);
      } else read = scalar(field, test.field);
      result = all(
        ...(test.min === undefined ? [] : [above(read, test.min)]),
        ...(test.max === undefined ? [] : [below(read, test.max)]),
        ...(test.values
          ? [any(...test.values.map((value) => all(above(read, value), below(read, value))))]
          : [])
      );
    }
    conditions.set(id, result);
    return result;
  };
  return (field: MagicField, groups: MagicCondition[][]) =>
    any(...groups.map((group) => all(...group.map((test) => compile(field, test)))));
}
export function magicRegionField(
  state: GenerationState,
  field: MagicField,
  groups: MagicCondition[][]
) {
  const read = regionReader(magicRegionCompiler(state)(field, groups));
  return (x: number, y: number) => (read(x, y) ? 1 : -1);
}
