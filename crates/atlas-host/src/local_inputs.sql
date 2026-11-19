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
    -- 0 feature, 1 network node, 2 network reach; data is the record as CBOR.
    kind INTEGER NOT NULL CHECK(kind IN (0,1,2)),
    id BLOB NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY(map_id,revision,kind,id)
);
CREATE TABLE IF NOT EXISTS generation_geography (
    world_id BLOB NOT NULL,
    area_id BLOB NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY(world_id,area_id,id)
);
