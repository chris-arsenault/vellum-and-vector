# Arconis: docs/architecture/subsystems.arconis#item=postgis — PostGIS image for the TrueNAS backend stack.
FROM postgis/postgis:18-3.7@sha256:e55337da273845fb2ad38f6151953f70fd93ac8ac2a3d2edbc4056c858783a5f
COPY --chmod=644 init-atlas.sh /docker-entrypoint-initdb.d/20-atlas.sh
