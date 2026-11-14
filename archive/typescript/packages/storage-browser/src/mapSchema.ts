/** Published map records have no foreign keys or resource reads into the generation schema. */
// owner-direction(2026-11-12): map and generation use separate schemas
export const mapSchema = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS maps (
  map_id TEXT NOT NULL, revision TEXT NOT NULL, descriptor TEXT NOT NULL,
  expected_revision TEXT, complete INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(map_id,revision)
);
CREATE TABLE IF NOT EXISTS map_heads (map_id TEXT PRIMARY KEY, revision TEXT NOT NULL,
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision));
CREATE TABLE IF NOT EXISTS map_navigation (
  map_id TEXT NOT NULL, revision TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY(map_id,revision),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map_saved (
  map_id TEXT PRIMARY KEY, revision TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL,
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision)
);
CREATE TABLE IF NOT EXISTS map_features (
  row_id INTEGER PRIMARY KEY, map_id TEXT NOT NULL, revision TEXT NOT NULL,
  id TEXT NOT NULL, space_id TEXT NOT NULL, layer_id TEXT NOT NULL, name TEXT,
  geometry BLOB NOT NULL, data BLOB NOT NULL, UNIQUE(map_id,revision,id),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS map_feature_scope ON map_features(map_id,revision,space_id,layer_id,id);
CREATE TABLE IF NOT EXISTS map_feature_catalog (
  row_id INTEGER PRIMARY KEY REFERENCES map_features(row_id) ON DELETE CASCADE,
  type TEXT NOT NULL, values_json TEXT NOT NULL, columns_json TEXT NOT NULL,
  attributes_json TEXT NOT NULL, relations_json TEXT NOT NULL, search TEXT NOT NULL, named INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS map_catalog_from_place ON map_feature_catalog(json_extract(attributes_json,'$.fromPlace'));
CREATE INDEX IF NOT EXISTS map_catalog_to_place ON map_feature_catalog(json_extract(attributes_json,'$.toPlace'));
CREATE INDEX IF NOT EXISTS map_catalog_at_place ON map_feature_catalog(json_extract(attributes_json,'$.atPlace'));
CREATE VIRTUAL TABLE IF NOT EXISTS map_catalog_bounds USING rtree(row_id,min_x,max_x,min_y,max_y);
CREATE VIRTUAL TABLE IF NOT EXISTS map_feature_bounds USING rtree(row_id,min_x,max_x,min_y,max_y);
CREATE TRIGGER IF NOT EXISTS map_feature_remove AFTER DELETE ON map_features BEGIN
  DELETE FROM map_feature_bounds WHERE row_id=old.row_id;
  DELETE FROM map_catalog_bounds WHERE row_id=old.row_id;
END;
CREATE TABLE IF NOT EXISTS map_samples (
  row_id INTEGER PRIMARY KEY, map_id TEXT NOT NULL, revision TEXT NOT NULL,
  id TEXT NOT NULL, space_id TEXT NOT NULL, geometry BLOB NOT NULL, data BLOB NOT NULL,
  UNIQUE(map_id,revision,id),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS map_sample_scope ON map_samples(map_id,revision,space_id,id);
CREATE VIRTUAL TABLE IF NOT EXISTS map_sample_bounds USING rtree(row_id,min_x,max_x,min_y,max_y);
CREATE TRIGGER IF NOT EXISTS map_sample_remove AFTER DELETE ON map_samples BEGIN
  DELETE FROM map_sample_bounds WHERE row_id=old.row_id;
END;
CREATE TABLE IF NOT EXISTS map_history (
  map_id TEXT NOT NULL, revision TEXT NOT NULL, id TEXT NOT NULL, data BLOB NOT NULL,
  PRIMARY KEY(map_id,revision,id),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map_history_features (
  map_id TEXT NOT NULL, revision TEXT NOT NULL, history_id TEXT NOT NULL, feature_id TEXT NOT NULL,
  PRIMARY KEY(map_id,revision,feature_id,history_id),
  FOREIGN KEY(map_id,revision,history_id) REFERENCES map_history(map_id,revision,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map_assets (
  map_id TEXT NOT NULL, revision TEXT NOT NULL, id TEXT NOT NULL, media_type TEXT NOT NULL,
  location TEXT NOT NULL, byte_length INTEGER NOT NULL, illustration INTEGER NOT NULL,
  PRIMARY KEY(map_id,revision,id),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map_entities (
  map_id TEXT NOT NULL, revision TEXT NOT NULL, id TEXT NOT NULL, data BLOB NOT NULL,
  PRIMARY KEY(map_id,revision,id),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
`;
