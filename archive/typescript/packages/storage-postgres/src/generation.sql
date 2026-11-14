CREATE SCHEMA IF NOT EXISTS generation;
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
