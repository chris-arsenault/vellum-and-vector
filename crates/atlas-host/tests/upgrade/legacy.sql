-- Rust PostGIS layout before the GIS-row and typed-identity rewrite.
CREATE SCHEMA map;
CREATE TABLE map.revisions (
  map_id text NOT NULL, revision text NOT NULL, descriptor jsonb NOT NULL,
  expected_revision text, complete boolean NOT NULL, PRIMARY KEY(map_id,revision)
);
CREATE TABLE map.heads (
  map_id text PRIMARY KEY, revision text NOT NULL,
  FOREIGN KEY(map_id,revision) REFERENCES map.revisions
);
CREATE TABLE map.saved (
  map_id text PRIMARY KEY, revision text NOT NULL, version bigint NOT NULL, data jsonb NOT NULL,
  FOREIGN KEY(map_id,revision) REFERENCES map.revisions
);
CREATE TABLE map.features (
  map_id text NOT NULL, revision text NOT NULL, id text NOT NULL, space_id text NOT NULL,
  layer_id text NOT NULL, name text, geometry geometry NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY(map_id,revision,id), FOREIGN KEY(map_id,revision) REFERENCES map.revisions
);
CREATE TABLE map.samples (
  map_id text NOT NULL, revision text NOT NULL, id text NOT NULL, space_id text NOT NULL,
  geometry geometry NOT NULL, data bytea NOT NULL, PRIMARY KEY(map_id,revision,id),
  FOREIGN KEY(map_id,revision) REFERENCES map.revisions
);
CREATE TABLE map.history (
  map_id text NOT NULL, revision text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY(map_id,revision,id), FOREIGN KEY(map_id,revision) REFERENCES map.revisions
);
CREATE TABLE map.history_features (
  map_id text NOT NULL, revision text NOT NULL, history_id text NOT NULL, feature_id text NOT NULL,
  PRIMARY KEY(map_id,revision,feature_id,history_id),
  FOREIGN KEY(map_id,revision,history_id) REFERENCES map.history
);
CREATE TABLE map.assets (
  map_id text NOT NULL, revision text NOT NULL, id text NOT NULL, media_type text NOT NULL,
  location text NOT NULL, byte_length bigint NOT NULL, illustration boolean NOT NULL,
  PRIMARY KEY(map_id,revision,id), FOREIGN KEY(map_id,revision) REFERENCES map.revisions
);
CREATE TABLE map.edits (
  map_id text NOT NULL, revision text NOT NULL, sequence integer NOT NULL, label text NOT NULL,
  undone boolean NOT NULL, data jsonb NOT NULL, PRIMARY KEY(map_id,revision,sequence),
  FOREIGN KEY(map_id,revision) REFERENCES map.revisions
);
CREATE TABLE map.entities (
  map_id text NOT NULL, revision text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY(map_id,revision,id), FOREIGN KEY(map_id,revision) REFERENCES map.revisions
);
CREATE SCHEMA generation;
CREATE TABLE generation.catalogs (id text PRIMARY KEY, document jsonb NOT NULL);
CREATE TABLE generation.inputs (
  map_id text NOT NULL, map_revision text NOT NULL, world_id text NOT NULL, area_id text NOT NULL,
  revision bigint NOT NULL, catalog_id text NOT NULL, PRIMARY KEY(map_id,map_revision)
);
CREATE TABLE generation.records (
  catalog_id text NOT NULL REFERENCES generation.catalogs, kind text NOT NULL,
  id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(catalog_id,kind,id)
);
CREATE TABLE generation.geography (
  world_id text NOT NULL, area_id text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY(world_id,area_id,id)
);
