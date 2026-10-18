import {
  geometrySchema,
  referenceSchema,
  requireThat,
  type World,
  type RevisionReference,
} from "@atlas/domain";
import { integer, type Sql } from "./database";
import { readMagic, readViews } from "./settings";

export async function writeWorldHeader(sql: Sql, world: World): Promise<void> {
  const reference = referenceSchema.parse({
    ...world.reference,
    version: world.reference.version ?? 1,
    precision: world.reference.precision ?? 0.000001,
  });
  const epochs = world.epochs,
    eras = world.humanEras ?? [];
  await sql.query(
    `INSERT INTO atlas_world_versions(world_id,version,name,seed,crs_id,domain,topology,units,axes,vertical_datum,crs_version,precision,epochs,human_eras)
    VALUES($1,$2,$3,$4,$5,ST_SetSRID(ST_GeomFromGeoJSON($6::text),0),$7,$8,$9,$10,$11,$12,
      ARRAY(SELECT ROW(e.id,e.tectonics,e.hydrology,e.ice,e.coasts,e.temperature,e.sea_level)::atlas_epoch
        FROM unnest($13::text[],$14::int[],$15::int[],$16::int[],$17::int[],$18::int[],$19::int[]) AS e(id,tectonics,hydrology,ice,coasts,temperature,sea_level)),
      ARRAY(SELECT ROW(e.id,e.years,e.physical_epoch,e.mobility,e.political_capacity)::atlas_human_era
        FROM unnest($20::text[],$21::int[],$22::text[],$23::float8[],$24::float8[]) AS e(id,years,physical_epoch,mobility,political_capacity)))`,
    [
      world.id,
      world.version,
      world.name,
      world.seed,
      reference.id,
      JSON.stringify(geometrySchema.parse(reference.domain)),
      reference.topology,
      reference.units,
      reference.axes,
      reference.verticalDatum,
      reference.version,
      reference.precision,
      epochs.map((e) => e.id),
      epochs.map((e) => e.tectonics),
      epochs.map((e) => e.hydrology),
      epochs.map((e) => e.ice),
      epochs.map((e) => e.coasts),
      epochs.map((e) => e.temperature),
      epochs.map((e) => e.seaLevel),
      eras.map((e) => e.id),
      eras.map((e) => e.years),
      eras.map((e) => e.physicalEpoch),
      eras.map((e) => e.mobility),
      eras.map((e) => e.politicalCapacity),
    ]
  );
}

export async function readWorldHeader(
  sql: Sql,
  id: string,
  version: number,
  references?: RevisionReference[]
): Promise<World> {
  const result = await sql.query<{
    name: string;
    seed: number;
    crs_id: string;
    domain: string;
    topology: string;
    units: string;
    axes: string;
    vertical_datum: string;
    crs_version: number;
    precision: number;
    owner: string;
  }>(
    `SELECT v.name,v.seed,v.crs_id,ST_AsGeoJSON(v.domain,15) AS domain,v.topology,v.units,v.axes,v.vertical_datum,v.crs_version,v.precision,w.owner
      FROM atlas_world_versions v JOIN atlas_worlds w ON w.id=v.world_id WHERE v.world_id=$1 AND v.version=$2`,
    [id, version]
  );
  requireThat(result.rowCount === 1, "not_found", "World version not found.");
  const row = result.rows[0];
  const world: World = {
    id,
    version,
    name: row.name,
    seed: row.seed,
    owner: row.owner,
    reference: {
      id: row.crs_id,
      domain: geometrySchema.parse(JSON.parse(row.domain)),
      topology: row.topology,
      units: row.units,
      axes: row.axes,
      verticalDatum: row.vertical_datum,
      version: row.crs_version,
      precision: row.precision,
    },
    areas: {},
    layers: {},
    features: {},
    entities: {},
    fields: [],
    templates: {},
    magic: [],
    epochs: [],
    humanEras: [],
    generations: [],
    views: [],
    connections: {},
  };
  await legacyHistory(sql, world);
  const magic = await readMagic(sql, id, version),
    views = await readViews(sql, id, version);
  world.magic = Object.values(magic.objects);
  world.views = Object.values(views.objects);
  references?.push(...magic.revisions, ...views.revisions);
  return world;
}

async function legacyHistory(sql: Sql, world: World): Promise<void> {
  const epochs = await sql.query<{
    id: string;
    tectonics: number;
    hydrology: number;
    ice: number;
    coasts: number;
    temperature: number;
    sea_level: number;
  }>(
    `SELECT (v.epochs[s.i]).* FROM atlas_world_versions v CROSS JOIN LATERAL generate_subscripts(v.epochs,1) s(i)
      WHERE world_id=$1 AND version=$2 ORDER BY s.i`,
    [world.id, world.version]
  );
  world.epochs = epochs.rows.map((row) => ({
    id: row.id,
    tectonics: row.tectonics,
    hydrology: row.hydrology,
    ice: row.ice,
    coasts: row.coasts,
    temperature: row.temperature,
    seaLevel: row.sea_level,
  }));
  const eras = await sql.query<{
    id: string;
    years: number;
    physical_epoch: string | null;
    mobility: number;
    political_capacity: number;
  }>(
    `SELECT (v.human_eras[s.i]).* FROM atlas_world_versions v CROSS JOIN LATERAL generate_subscripts(v.human_eras,1) s(i)
      WHERE world_id=$1 AND version=$2 ORDER BY s.i`,
    [world.id, world.version]
  );
  world.humanEras = eras.rows.map((row) => ({
    id: row.id,
    years: integer(row.years),
    physicalEpoch: row.physical_epoch,
    mobility: row.mobility,
    politicalCapacity: row.political_capacity,
  }));
}
