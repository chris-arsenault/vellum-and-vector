-- Arconis: docs/architecture/subsystems.arconis#item=s_gen — SQLite tables of the private generation schema.
CREATE TABLE IF NOT EXISTS generation_catalogs (
    map_id BLOB NOT NULL,
    revision BLOB NOT NULL,
    document TEXT NOT NULL,
    PRIMARY KEY(map_id,revision)
);
CREATE TABLE IF NOT EXISTS generation_records (
    map_id BLOB NOT NULL,
    revision BLOB NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('feature','node','reach')),
    id BLOB NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY(map_id,revision,kind,id)
);
CREATE TABLE IF NOT EXISTS generation_geography (
    world_id BLOB NOT NULL,
    area_id BLOB NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY(world_id,area_id,id)
);
