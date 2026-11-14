DO $$ BEGIN
  IF to_regnamespace('generation') IS NULL THEN CREATE SCHEMA generation; END IF;
END $$;
REVOKE ALL ON SCHEMA generation FROM PUBLIC;

-- Completed inputs are immutable map-owned captures, not execution checkpoints.
CREATE TABLE IF NOT EXISTS generation.inputs (
  map_id text NOT NULL, map_revision text NOT NULL,
  world_id text NOT NULL, area_id text NOT NULL, revision bigint NOT NULL,
  catalog_id text NOT NULL,
  PRIMARY KEY(map_id,map_revision)
);
CREATE INDEX IF NOT EXISTS generation_input_version
  ON generation.inputs(world_id,area_id,revision DESC);

CREATE TABLE IF NOT EXISTS generation.catalogs (
  id text PRIMARY KEY,
  document jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS generation.records (
  catalog_id text NOT NULL REFERENCES generation.catalogs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('feature','node','reach')),
  id text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY(catalog_id,kind,id)
);
CREATE TABLE IF NOT EXISTS generation.geography (
  world_id text NOT NULL, area_id text NOT NULL, id text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY(world_id,area_id,id)
);
