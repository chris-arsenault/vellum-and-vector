-- Arconis: docs/architecture/subsystems.arconis#item=r_schema — PostGIS tables of the published map schema.
CREATE EXTENSION IF NOT EXISTS postgis;
-- owner-direction(2026-11-12): map and generation use separate schemas
DO $$ BEGIN
  IF to_regnamespace('map') IS NULL THEN CREATE SCHEMA map; END IF;
END $$;

-- A map revision's own facts. Its spaces, layers, bands, categories, feature types and
-- declared properties are rows below; real-scale authoring settings are one open value.
CREATE TABLE IF NOT EXISTS map.revisions (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  expected_revision uuid,
  complete boolean NOT NULL DEFAULT false,
  world_id uuid NOT NULL,
  name text NOT NULL,
  primary_space_id uuid NOT NULL,
  profile text NOT NULL,
  region_level integer NOT NULL,
  region_next_area double precision NOT NULL,
  region_subdivision double precision NOT NULL,
  region_minimum_width double precision NOT NULL,
  region_enabled boolean NOT NULL,
  footprint geometry NOT NULL CHECK (ST_IsValid(footprint) AND ST_SRID(footprint)=0),
  bounds double precision[4] NOT NULL,
  parent_map_id uuid,
  parent_revision uuid,
  real_scale jsonb,
  PRIMARY KEY (map_id, revision)
);
CREATE INDEX IF NOT EXISTS map_revision_parent ON map.revisions(parent_map_id, parent_revision);
CREATE INDEX IF NOT EXISTS map_revision_world ON map.revisions(world_id);
CREATE TABLE IF NOT EXISTS map.heads (
  map_id uuid PRIMARY KEY,
  revision uuid NOT NULL,
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions
);
CREATE TABLE IF NOT EXISTS map.saved (
  map_id uuid PRIMARY KEY, revision uuid NOT NULL, version bigint NOT NULL, data jsonb NOT NULL,
  FOREIGN KEY(map_id,revision) REFERENCES map.revisions
);
CREATE TABLE IF NOT EXISTS map.spaces (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  ordinal integer NOT NULL,
  id uuid NOT NULL,
  parent_space_id uuid,
  bounds double precision[4] NOT NULL,
  metres_per_unit double precision NOT NULL,
  precision double precision NOT NULL,
  periodic_width double precision,
  origin double precision[3] NOT NULL,
  rotation double precision NOT NULL,
  floor text,
  PRIMARY KEY (map_id, revision, id),
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map.layers (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  ordinal integer NOT NULL,
  id text NOT NULL,
  space_id uuid NOT NULL,
  name text NOT NULL,
  bounds double precision[4] NOT NULL,
  attribution text[] NOT NULL,
  source smallint NOT NULL,
  asset_id text,
  media_type text,
  width integer,
  height integer,
  cell_span double precision,
  overviews text[] NOT NULL,
  band_indices smallint[] NOT NULL,
  path text[] NOT NULL,
  common boolean NOT NULL,
  default_style jsonb,
  presets text[] NOT NULL,
  examples uuid[] NOT NULL,
  geometries smallint[] NOT NULL,
  PRIMARY KEY (map_id, revision, ordinal),
  UNIQUE (map_id, revision, id),
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map.bands (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  layer integer NOT NULL,
  ordinal integer NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL,
  display_unit text NOT NULL,
  display_factor double precision NOT NULL,
  nodata double precision,
  range_low double precision,
  range_high double precision,
  PRIMARY KEY (map_id, revision, layer, ordinal),
  FOREIGN KEY (map_id, revision, layer) REFERENCES map.layers ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map.categories (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  layer integer NOT NULL,
  band integer NOT NULL,
  ordinal integer NOT NULL,
  value integer NOT NULL,
  label text NOT NULL,
  color text,
  present boolean NOT NULL,
  soluble boolean,
  bathymetric boolean,
  tint double precision,
  system text,
  system_name text,
  PRIMARY KEY (map_id, revision, layer, band, ordinal),
  FOREIGN KEY (map_id, revision, layer, band) REFERENCES map.bands ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map.feature_types (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  layer integer NOT NULL,
  ordinal integer NOT NULL,
  id text NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  path text[] NOT NULL,
  magic_depiction smallint,
  count integer NOT NULL,
  geometries smallint[] NOT NULL,
  footprints boolean NOT NULL,
  size_least double precision,
  size_typical double precision,
  size_largest double precision,
  size_elongation double precision,
  size_round boolean,
  PRIMARY KEY (map_id, revision, layer, ordinal),
  UNIQUE (map_id, revision, layer, id),
  FOREIGN KEY (map_id, revision, layer) REFERENCES map.layers ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map.layer_properties (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  layer integer NOT NULL,
  name text NOT NULL,
  kind smallint NOT NULL,
  PRIMARY KEY (map_id, revision, layer, name),
  FOREIGN KEY (map_id, revision, layer) REFERENCES map.layers ON DELETE CASCADE
);
-- A feature's common facts are columns; its undeclared attributes and the registry's derived
-- values (whose columns differ by layer) are open values.
CREATE TABLE IF NOT EXISTS map.features (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  id uuid NOT NULL,
  space_id uuid NOT NULL,
  layer_id text NOT NULL,
  type_id text NOT NULL,
  kind text NOT NULL,
  name text,
  entity_id uuid,
  origin text NOT NULL,
  map_only boolean NOT NULL,
  geometry geometry NOT NULL CHECK (ST_IsValid(geometry) AND ST_SRID(geometry)=0),
  footprint geometry CHECK (footprint IS NULL OR (ST_IsValid(footprint) AND ST_SRID(footprint)=0)),
  attributes jsonb NOT NULL,
  catalog jsonb NOT NULL,
  causes text[] NOT NULL,
  PRIMARY KEY (map_id, revision, id),
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS map_feature_scope ON map.features(map_id, revision, space_id, layer_id, id);
CREATE INDEX IF NOT EXISTS map_feature_geometry ON map.features USING gist(geometry);
CREATE INDEX IF NOT EXISTS map_feature_footprint ON map.features USING gist(footprint);
CREATE INDEX IF NOT EXISTS map_from_place ON map.features(map_id,revision,(attributes->>'fromPlace'));
CREATE INDEX IF NOT EXISTS map_to_place ON map.features(map_id,revision,(attributes->>'toPlace'));
CREATE INDEX IF NOT EXISTS map_at_place ON map.features(map_id,revision,(attributes->>'atPlace'));
CREATE TABLE IF NOT EXISTS map.relations (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  feature_id uuid NOT NULL,
  ordinal integer NOT NULL,
  kind text NOT NULL,
  target_id uuid NOT NULL,
  target_map_id uuid,
  target_name text NOT NULL,
  PRIMARY KEY (map_id, revision, feature_id, ordinal),
  FOREIGN KEY (map_id, revision, feature_id) REFERENCES map.features ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS map_relation_target ON map.relations(map_id, revision, target_id, kind);
CREATE TABLE IF NOT EXISTS map.samples (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  id text NOT NULL,
  space_id uuid NOT NULL,
  geometry geometry NOT NULL CHECK (ST_IsValid(geometry) AND ST_SRID(geometry)=0),
  data bytea NOT NULL,
  PRIMARY KEY (map_id, revision, id),
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS map_sample_scope ON map.samples(map_id, revision, space_id, id);
CREATE INDEX IF NOT EXISTS map_sample_geometry ON map.samples USING gist(geometry);
CREATE TABLE IF NOT EXISTS map.history (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  id uuid NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (map_id, revision, id),
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map.history_features (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  history_id uuid NOT NULL,
  feature_id uuid NOT NULL,
  PRIMARY KEY (map_id, revision, feature_id, history_id),
  FOREIGN KEY (map_id, revision, history_id) REFERENCES map.history ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map.assets (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  id text NOT NULL,
  media_type text NOT NULL,
  location text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  illustration boolean NOT NULL,
  PRIMARY KEY (map_id, revision, id),
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions ON DELETE CASCADE
);
-- Undo steps of an authored real-scale map; data holds the features before and after.
CREATE TABLE IF NOT EXISTS map.edits (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  sequence integer NOT NULL,
  label text NOT NULL,
  undone boolean NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (map_id, revision, sequence),
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map.entities (
  map_id uuid NOT NULL,
  revision uuid NOT NULL,
  id uuid NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (map_id, revision, id),
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions ON DELETE CASCADE
);
