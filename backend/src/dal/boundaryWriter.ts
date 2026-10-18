import type { Area, FieldSample } from "@atlas/domain";
import { insertRows, type Sql } from "./database";

type Boundary = NonNullable<Area["boundary"]>;

async function samples(sql: Sql, revision: string, boundary: Boundary): Promise<void> {
  const rings = [
    { ring: -1, samples: boundary.samples },
    ...(boundary.rings ?? []).map((samples, ring) => ({ ring, samples })),
  ];
  await insertRows(
    sql,
    "atlas_boundary_rings",
    ["revision_id", "ring"],
    rings.map((ring) => [revision, ring.ring])
  );
  const row = (sample: FieldSample, ring: number, ordinal: number) => [
    revision,
    ring,
    ordinal,
    sample.point.x,
    sample.point.y,
    sample.point.z,
    Object.keys(sample.values),
    Object.values(sample.values),
  ];
  await insertRows(
    sql,
    "atlas_boundary_samples",
    ["revision_id", "ring", "ordinal", "x", "y", "z", "channels", "values"],
    rings.flatMap((ring) => ring.samples.map((sample, i) => row(sample, ring.ring, i)))
  );
}

async function crossings(sql: Sql, revision: string, boundary: Boundary): Promise<void> {
  await insertRows(
    sql,
    "atlas_boundary_crossings",
    [
      "revision_id",
      "ordinal",
      "feature_id",
      "x",
      "y",
      "z",
      "kind",
      "flow",
      "elevation",
      "direction",
      "node_id",
      "receiving_feature",
      "flow_uncertainty",
      "flow_minimum",
      "flow_maximum",
      "flow_known",
      "elevation_known",
    ],
    boundary.crossings.map((crossing, i) => [
      revision,
      i,
      crossing.featureId,
      crossing.point.x,
      crossing.point.y,
      crossing.point.z,
      crossing.kind,
      crossing.flow,
      crossing.elevation,
      crossing.direction ?? "undirected",
      crossing.nodeId ?? null,
      crossing.receivingFeatureId ?? null,
      crossing.flowUncertainty ?? 0,
      crossing.flowMinimum ?? null,
      crossing.flowMaximum ?? null,
      crossing.flowKnown ?? null,
      crossing.elevationKnown ?? null,
    ])
  );
}

async function history(
  sql: Sql,
  scope: string,
  revision: string,
  boundary: Boundary
): Promise<void> {
  await insertRows(
    sql,
    "atlas_boundary_epochs",
    [
      "revision_id",
      "ordinal",
      "id",
      "tectonics",
      "hydrology",
      "ice",
      "coasts",
      "temperature",
      "sea_level",
    ],
    boundary.epochs.map((epoch, i) => [
      revision,
      i,
      epoch.id,
      epoch.tectonics,
      epoch.hydrology,
      epoch.ice,
      epoch.coasts,
      epoch.temperature,
      epoch.seaLevel,
    ])
  );
  await insertRows(
    sql,
    "atlas_boundary_history",
    ["revision_id", "ordinal", "scope_id", "epoch_id", "parent_epoch", "forcing"],
    (boundary.history ?? []).map((epoch, i) => [
      revision,
      i,
      scope,
      epoch.epochId,
      epoch.parentEpoch,
      epoch.forcingId,
    ])
  );
  await insertRows(
    sql,
    "atlas_boundary_history_resources",
    ["revision_id", "epoch_ordinal", "ordinal", "scope_id", "resource_id"],
    (boundary.history ?? []).flatMap((epoch, i) =>
      epoch.resources.map((resource, j) => [revision, i, j, scope, resource])
    )
  );
}

export async function writeBoundary(
  sql: Sql,
  scope: string,
  revision: string,
  boundary: Boundary
): Promise<void> {
  await sql.query("INSERT INTO atlas_boundaries VALUES($1,$2,$3,$4,$5,$6,$7)", [
    revision,
    scope,
    boundary.version,
    boundary.parentId,
    boundary.parentVersion,
    boundary.rings != null,
    boundary.waterFluxes != null,
  ]);
  await samples(sql, revision, boundary);
  await crossings(sql, revision, boundary);
  await history(sql, scope, revision, boundary);
  await insertRows(
    sql,
    "atlas_boundary_fluxes",
    ["revision_id", "ordinal", "id", "x", "y", "z", "dx", "dy", "dz", "rate", "crossing"],
    (boundary.waterFluxes ?? []).map((flux, i) => [
      revision,
      i,
      flux.id,
      flux.point.x,
      flux.point.y,
      flux.point.z,
      flux.direction.x,
      flux.direction.y,
      flux.direction.z,
      flux.rate,
      flux.crossing,
    ])
  );
}
