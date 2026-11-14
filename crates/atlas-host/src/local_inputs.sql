CREATE TABLE IF NOT EXISTS generation_catalogs (
    map_id TEXT NOT NULL,
    revision TEXT NOT NULL,
    document TEXT NOT NULL,
    PRIMARY KEY(map_id,revision)
);
CREATE TABLE IF NOT EXISTS generation_records (
    map_id TEXT NOT NULL,
    revision TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('feature','node','reach')),
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY(map_id,revision,kind,id)
);
CREATE TABLE IF NOT EXISTS generation_geography (
    world_id TEXT NOT NULL,
    area_id TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY(world_id,area_id,id)
);
