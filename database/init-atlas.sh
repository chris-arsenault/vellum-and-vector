#!/usr/bin/env bash
set -euo pipefail

: "${ATLAS_MAP_PASSWORD:?}"
: "${ATLAS_MAP_READER_PASSWORD:?}"
: "${ATLAS_GENERATION_PASSWORD:?}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<'SQL'
\getenv map_password ATLAS_MAP_PASSWORD
\getenv reader_password ATLAS_MAP_READER_PASSWORD
\getenv generation_password ATLAS_GENERATION_PASSWORD
CREATE ROLE atlas_maps LOGIN PASSWORD :'map_password';
CREATE ROLE atlas_map_reader LOGIN PASSWORD :'reader_password';
CREATE ROLE atlas_generation LOGIN PASSWORD :'generation_password';
CREATE DATABASE vellum_maps OWNER atlas_maps TEMPLATE template0;
CREATE DATABASE vellum_generation OWNER atlas_generation TEMPLATE template0;
REVOKE CONNECT, TEMPORARY ON DATABASE vellum_maps FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE vellum_generation FROM PUBLIC;
GRANT CONNECT ON DATABASE vellum_maps TO atlas_maps, atlas_map_reader;
GRANT CONNECT ON DATABASE vellum_generation TO atlas_generation;

\connect vellum_maps
CREATE EXTENSION postgis;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA map AUTHORIZATION atlas_maps;
REVOKE ALL ON SCHEMA map FROM PUBLIC;
GRANT USAGE ON SCHEMA map TO atlas_map_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE atlas_maps IN SCHEMA map
    GRANT SELECT ON TABLES TO atlas_map_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE atlas_maps IN SCHEMA map
    GRANT SELECT ON SEQUENCES TO atlas_map_reader;

\connect vellum_generation
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA generation AUTHORIZATION atlas_generation;
REVOKE ALL ON SCHEMA generation FROM PUBLIC;
SQL
