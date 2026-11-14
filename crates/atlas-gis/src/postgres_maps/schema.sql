CREATE EXTENSION IF NOT EXISTS postgis;
-- owner-direction(2026-11-12): map and generation use separate schemas
DO $$ BEGIN
  IF to_regnamespace('map') IS NULL THEN CREATE SCHEMA map; END IF;
END $$;

-- Match the browser GEOS boundary: reject invalid source shapes and precision collapse.
CREATE OR REPLACE FUNCTION map.canonical_geometry(value text, grid_size double precision)
RETURNS geometry LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE shape geometry;
BEGIN
  shape := ST_SetSRID(ST_GeomFromGeoJSON(value),0);
  IF NOT ST_IsValid(shape) THEN RAISE EXCEPTION 'Geometry must be valid.'; END IF;
  shape := ST_ReducePrecision(shape,grid_size);
  IF ST_IsEmpty(shape) THEN RAISE EXCEPTION 'Geometry collapses at its declared precision.'; END IF;
  RETURN shape;
END;
$$;

CREATE TABLE IF NOT EXISTS map.revisions (
  map_id text NOT NULL,
  revision text NOT NULL,
  descriptor jsonb NOT NULL,
  expected_revision text,
  complete boolean NOT NULL DEFAULT false,
  PRIMARY KEY (map_id, revision)
);
CREATE TABLE IF NOT EXISTS map.heads (
  map_id text PRIMARY KEY,
  revision text NOT NULL,
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions
);
CREATE TABLE IF NOT EXISTS map.saved (
  map_id text PRIMARY KEY, revision text NOT NULL, version bigint NOT NULL, data jsonb NOT NULL,
  FOREIGN KEY(map_id,revision) REFERENCES map.revisions
);
CREATE TABLE IF NOT EXISTS map.features (
  map_id text NOT NULL,
  revision text NOT NULL,
  id text NOT NULL,
  space_id text NOT NULL,
  layer_id text NOT NULL,
  name text,
  geometry geometry NOT NULL CHECK (ST_IsValid(geometry) AND ST_SRID(geometry)=0),
  data jsonb NOT NULL,
  PRIMARY KEY (map_id, revision, id),
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS map_feature_scope ON map.features(map_id, revision, space_id, layer_id, id);
CREATE INDEX IF NOT EXISTS map_feature_geometry ON map.features USING gist(geometry);
CREATE INDEX IF NOT EXISTS map_from_place ON map.features(map_id,revision,(data#>>'{attributes,fromPlace}'));
CREATE INDEX IF NOT EXISTS map_to_place ON map.features(map_id,revision,(data#>>'{attributes,toPlace}'));
CREATE INDEX IF NOT EXISTS map_at_place ON map.features(map_id,revision,(data#>>'{attributes,atPlace}'));
CREATE INDEX IF NOT EXISTS map_relations ON map.features USING gin((data->'relations') jsonb_path_ops);
CREATE TABLE IF NOT EXISTS map.samples (
  map_id text NOT NULL,
  revision text NOT NULL,
  id text NOT NULL,
  space_id text NOT NULL,
  geometry geometry NOT NULL CHECK (ST_IsValid(geometry) AND ST_SRID(geometry)=0),
  data bytea NOT NULL,
  PRIMARY KEY (map_id, revision, id),
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS map_sample_scope ON map.samples(map_id, revision, space_id, id);
CREATE INDEX IF NOT EXISTS map_sample_geometry ON map.samples USING gist(geometry);
CREATE TABLE IF NOT EXISTS map.history (
  map_id text NOT NULL,
  revision text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (map_id, revision, id),
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map.history_features (
  map_id text NOT NULL,
  revision text NOT NULL,
  history_id text NOT NULL,
  feature_id text NOT NULL,
  PRIMARY KEY (map_id, revision, feature_id, history_id),
  FOREIGN KEY (map_id, revision, history_id) REFERENCES map.history ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map.assets (
  map_id text NOT NULL,
  revision text NOT NULL,
  id text NOT NULL,
  media_type text NOT NULL,
  location text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  illustration boolean NOT NULL,
  PRIMARY KEY (map_id, revision, id),
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map.entities (
  map_id text NOT NULL,
  revision text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (map_id, revision, id),
  FOREIGN KEY (map_id, revision) REFERENCES map.revisions ON DELETE CASCADE
);
