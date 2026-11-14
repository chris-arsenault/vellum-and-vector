-- Run against the dedicated atlas database as its administrator. These three
-- login roles must already exist; pass their names through psql -v variables.
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS map AUTHORIZATION :"map_writer";
CREATE SCHEMA IF NOT EXISTS generation AUTHORIZATION :"generation_writer";
REVOKE ALL ON SCHEMA generation FROM PUBLIC;
REVOKE ALL ON SCHEMA generation FROM :"map_reader", :"map_writer";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA map TO :"map_reader";
GRANT SELECT ON ALL TABLES IN SCHEMA map TO :"map_reader";
ALTER DEFAULT PRIVILEGES FOR ROLE :"map_writer" IN SCHEMA map
  GRANT SELECT ON TABLES TO :"map_reader";
