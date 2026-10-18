import type { Area, Crossing, Epoch, FieldSample, WaterFlux } from "@atlas/domain";
import { integer, type Sql } from "./database";

async function crossings(sql: Sql, areas: Map<string, Area>): Promise<void> {
  const rows = await sql.query<{
    revision_id: string;
    feature_id: string;
    x: number;
    y: number;
    z: number;
    kind: string;
    flow: number;
    elevation: number;
    direction: string;
    node_id: string | null;
    receiving_feature: string | null;
    flow_uncertainty: number;
    flow_minimum: number | null;
    flow_maximum: number | null;
    flow_known: boolean | null;
    elevation_known: boolean | null;
  }>("SELECT * FROM atlas_boundary_crossings WHERE revision_id=ANY($1::uuid[]) ORDER BY ordinal", [
    [...areas.keys()],
  ]);
  for (const row of rows.rows)
    areas.get(row.revision_id)!.boundary!.crossings.push({
      featureId: row.feature_id,
      point: { x: row.x, y: row.y, z: row.z },
      kind: row.kind,
      flow: row.flow,
      elevation: row.elevation,
      direction: row.direction,
      nodeId: row.node_id,
      receivingFeatureId: row.receiving_feature,
      flowUncertainty: row.flow_uncertainty,
      flowMinimum: row.flow_minimum,
      flowMaximum: row.flow_maximum,
      ...(row.flow_known === null ? {} : { flowKnown: row.flow_known }),
      ...(row.elevation_known === null ? {} : { elevationKnown: row.elevation_known }),
    } satisfies Crossing);
}

async function samples(sql: Sql, areas: Map<string, Area>): Promise<void> {
  const rings = await sql.query<{ revision_id: string; ring: number }>(
    "SELECT * FROM atlas_boundary_rings WHERE revision_id=ANY($1::uuid[]) AND ring>=0 ORDER BY ring",
    [[...areas.keys()]]
  );
  for (const row of rings.rows) areas.get(row.revision_id)!.boundary!.rings!.push([]);
  const rows = await sql.query<{
    revision_id: string;
    ring: number;
    x: number;
    y: number;
    z: number;
    channels: string[];
    values: number[];
  }>(
    "SELECT * FROM atlas_boundary_samples WHERE revision_id=ANY($1::uuid[]) ORDER BY ring,ordinal",
    [[...areas.keys()]]
  );
  for (const row of rows.rows) {
    const sample: FieldSample = {
      point: { x: row.x, y: row.y, z: row.z },
      values: Object.fromEntries(row.channels.map((name, i) => [name, row.values[i]])),
    };
    const boundary = areas.get(row.revision_id)!.boundary!;
    if (row.ring === -1) boundary.samples.push(sample);
    else boundary.rings![row.ring].push(sample);
  }
}

async function historical(sql: Sql, areas: Map<string, Area>): Promise<void> {
  const rows = await sql.query<Epoch & { revision_id: string; sea_level: number }>(
    "SELECT * FROM atlas_boundary_epochs WHERE revision_id=ANY($1::uuid[]) ORDER BY ordinal",
    [[...areas.keys()]]
  );
  for (const row of rows.rows)
    areas.get(row.revision_id)!.boundary!.epochs.push({
      id: row.id,
      tectonics: row.tectonics,
      hydrology: row.hydrology,
      ice: row.ice,
      coasts: row.coasts,
      temperature: row.temperature,
      seaLevel: row.sea_level,
    });
  const history = await sql.query<{
    revision_id: string;
    ordinal: number;
    epoch_id: string;
    parent_epoch: string | null;
    forcing: string | null;
  }>("SELECT * FROM atlas_boundary_history WHERE revision_id=ANY($1::uuid[]) ORDER BY ordinal", [
    [...areas.keys()],
  ]);
  const resources = await sql.query<{
    revision_id: string;
    epoch_ordinal: number;
    resource_id: string;
  }>(
    "SELECT * FROM atlas_boundary_history_resources WHERE revision_id=ANY($1::uuid[]) ORDER BY ordinal",
    [[...areas.keys()]]
  );
  for (const row of history.rows)
    areas.get(row.revision_id)!.boundary!.history!.push({
      epochId: row.epoch_id,
      parentEpoch: row.parent_epoch,
      forcingId: row.forcing,
      resources: resources.rows
        .filter(
          (resource) =>
            resource.revision_id === row.revision_id && resource.epoch_ordinal === row.ordinal
        )
        .map((resource) => resource.resource_id),
    });
}

async function fluxes(sql: Sql, areas: Map<string, Area>): Promise<void> {
  const rows = await sql.query<
    WaterFlux & {
      revision_id: string;
      x: number;
      y: number;
      z: number;
      dx: number;
      dy: number;
      dz: number;
    }
  >("SELECT * FROM atlas_boundary_fluxes WHERE revision_id=ANY($1::uuid[]) ORDER BY ordinal", [
    [...areas.keys()],
  ]);
  for (const row of rows.rows)
    areas.get(row.revision_id)!.boundary!.waterFluxes!.push({
      id: row.id,
      point: { x: row.x, y: row.y, z: row.z },
      direction: { x: row.dx, y: row.dy, z: row.dz },
      rate: row.rate,
      crossing: row.crossing,
    });
}

export async function readBoundaries(
  sql: Sql,
  scope: string,
  areas: Map<string, Area>
): Promise<void> {
  if (areas.size === 0) return;
  const headers = await sql.query<{
    revision_id: string;
    version: string;
    parent_id: string;
    parent_version: string;
    has_rings: boolean;
    has_fluxes: boolean;
  }>("SELECT * FROM atlas_boundaries WHERE scope_id=$1 AND revision_id=ANY($2::uuid[])", [
    scope,
    [...areas.keys()],
  ]);
  const bounded = new Map<string, Area>();
  for (const row of headers.rows) {
    const area = areas.get(row.revision_id)!;
    area.boundary = {
      version: integer(row.version),
      parentId: row.parent_id,
      parentVersion: integer(row.parent_version),
      crossings: [],
      samples: [],
      epochs: [],
      rings: row.has_rings ? [] : null,
      waterFluxes: row.has_fluxes ? [] : null,
      history: [],
    };
    bounded.set(row.revision_id, area);
  }
  if (bounded.size === 0) return;
  await crossings(sql, bounded);
  await samples(sql, bounded);
  await historical(sql, bounded);
  await fluxes(sql, bounded);
}
