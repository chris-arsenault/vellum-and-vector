export const catalogSchema = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS geometry_values (
  geometry_id INTEGER PRIMARY KEY,data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS geometry_piece_ready (
  geometry_id INTEGER PRIMARY KEY REFERENCES geometry_values ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS geometry_pieces (
  piece_id INTEGER PRIMARY KEY,geometry_id INTEGER NOT NULL REFERENCES geometry_values ON DELETE CASCADE,
  data BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS geometry_piece_owner ON geometry_pieces(geometry_id);
CREATE VIRTUAL TABLE IF NOT EXISTS geometry_piece_bounds USING rtree(piece_id,min_x,max_x,min_y,max_y);
CREATE TRIGGER IF NOT EXISTS geometry_piece_remove AFTER DELETE ON geometry_pieces BEGIN
  DELETE FROM geometry_piece_bounds WHERE piece_id=old.piece_id;
END;
CREATE TABLE IF NOT EXISTS geometry_overviews (
  geometry_id INTEGER NOT NULL REFERENCES geometry_values ON DELETE CASCADE,
  tolerance REAL NOT NULL,data BLOB NOT NULL,PRIMARY KEY(geometry_id,tolerance)
);
CREATE TABLE IF NOT EXISTS records_core (
  record_id INTEGER PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  space_id TEXT NOT NULL, area_id TEXT NOT NULL,
  kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
  data TEXT NOT NULL, layer_id TEXT, geometry_type TEXT, geometry_id INTEGER REFERENCES geometry_values,
  footprint_id INTEGER REFERENCES geometry_values, geometry_key TEXT NOT NULL,
  UNIQUE(world_id,kind,id)
);
CREATE VIEW IF NOT EXISTS records AS SELECT r.*,g.data AS geometry,p.data AS footprint
  FROM records_core r LEFT JOIN geometry_values g ON g.geometry_id=r.geometry_id
  LEFT JOIN geometry_values p ON p.geometry_id=r.footprint_id;
CREATE INDEX IF NOT EXISTS records_scope ON records_core(world_id,space_id,area_id,kind,id);
CREATE INDEX IF NOT EXISTS records_identity ON records_core(world_id,id);
CREATE INDEX IF NOT EXISTS records_layer ON records_core(world_id,kind,layer_id);
CREATE INDEX IF NOT EXISTS records_parent ON records_core(world_id,kind,json_extract(data,'$.value.parentId'));
CREATE INDEX IF NOT EXISTS records_feature ON records_core(world_id,kind,json_extract(data,'$.value.featureId'));
CREATE TABLE IF NOT EXISTS identities (
  world_id TEXT NOT NULL REFERENCES worlds(id), id TEXT NOT NULL,kind TEXT NOT NULL,
  PRIMARY KEY(world_id,id)
);
CREATE TABLE IF NOT EXISTS record_links (
  source INTEGER NOT NULL REFERENCES records_core(record_id) ON DELETE CASCADE,
  world_id TEXT NOT NULL, target TEXT NOT NULL, relation TEXT NOT NULL,
  PRIMARY KEY(source,target,relation)
);
CREATE INDEX IF NOT EXISTS record_link_targets ON record_links(world_id,target,relation,source);
CREATE VIRTUAL TABLE IF NOT EXISTS record_bounds USING rtree(record_id,min_x,max_x,min_y,max_y);
CREATE TRIGGER IF NOT EXISTS records_remove_bounds AFTER DELETE ON records_core BEGIN
  DELETE FROM record_bounds WHERE record_id=old.record_id;
END;
CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS field_geography (
  world_id TEXT NOT NULL REFERENCES worlds(id),id TEXT NOT NULL,
  space_id TEXT NOT NULL,area_id TEXT NOT NULL,data TEXT NOT NULL,
  PRIMARY KEY(world_id,id)
);
CREATE TABLE IF NOT EXISTS field_geometry_parts (
  part_id INTEGER PRIMARY KEY,world_id TEXT NOT NULL,geography_id TEXT NOT NULL,
  role TEXT NOT NULL,geometry_id INTEGER NOT NULL REFERENCES geometry_values,
  FOREIGN KEY(world_id,geography_id) REFERENCES field_geography(world_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS field_parts_owner ON field_geometry_parts(world_id,geography_id,role);
CREATE VIRTUAL TABLE IF NOT EXISTS field_geometry_bounds USING rtree(part_id,min_x,max_x,min_y,max_y);
CREATE TRIGGER IF NOT EXISTS field_parts_remove_bounds AFTER DELETE ON field_geometry_parts BEGIN
  DELETE FROM field_geometry_bounds WHERE part_id=old.part_id;
END;
`;
