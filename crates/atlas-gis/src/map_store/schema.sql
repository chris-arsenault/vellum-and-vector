-- owner-direction(2026-11-12): map and generation use separate schemas
-- Arconis: docs/architecture/subsystems.arconis#item=r_schema — SQLite tables of the published map schema.
-- The same rows as the PostGIS map schema: identities are 16-byte blobs, short lists are packed
-- CBOR blobs, open values are JSON text, and geometry is WKB with rtree bounds.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS maps (
  map_id BLOB NOT NULL, revision BLOB NOT NULL, expected_revision BLOB,
  complete INTEGER NOT NULL DEFAULT 0, world_id BLOB NOT NULL, name TEXT NOT NULL,
  primary_space_id BLOB NOT NULL, profile TEXT NOT NULL, region_level INTEGER NOT NULL,
  region_next_area REAL NOT NULL, region_subdivision REAL NOT NULL,
  region_minimum_width REAL NOT NULL, region_enabled INTEGER NOT NULL, footprint BLOB NOT NULL,
  min_x REAL NOT NULL, min_y REAL NOT NULL, max_x REAL NOT NULL, max_y REAL NOT NULL,
  parent_map_id BLOB, parent_revision BLOB, real_scale TEXT,
  PRIMARY KEY(map_id,revision)
);
CREATE INDEX IF NOT EXISTS map_parent ON maps(parent_map_id,parent_revision);
CREATE INDEX IF NOT EXISTS map_world ON maps(world_id);
CREATE TABLE IF NOT EXISTS map_heads (map_id BLOB PRIMARY KEY, revision BLOB NOT NULL,
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision));
CREATE TABLE IF NOT EXISTS map_saved (
  map_id BLOB PRIMARY KEY, revision BLOB NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL,
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision)
);
CREATE TABLE IF NOT EXISTS map_spaces (
  map_id BLOB NOT NULL, revision BLOB NOT NULL, ordinal INTEGER NOT NULL, id BLOB NOT NULL,
  parent_space_id BLOB, min_x REAL NOT NULL, min_y REAL NOT NULL, max_x REAL NOT NULL,
  max_y REAL NOT NULL, metres_per_unit REAL NOT NULL, precision REAL NOT NULL,
  periodic_width REAL, origin_x REAL NOT NULL, origin_y REAL NOT NULL, origin_z REAL NOT NULL,
  rotation REAL NOT NULL, floor TEXT,
  PRIMARY KEY(map_id,revision,id),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map_layers (
  map_id BLOB NOT NULL, revision BLOB NOT NULL, ordinal INTEGER NOT NULL, id TEXT NOT NULL,
  space_id BLOB NOT NULL, name TEXT NOT NULL, min_x REAL NOT NULL, min_y REAL NOT NULL,
  max_x REAL NOT NULL, max_y REAL NOT NULL, attribution BLOB NOT NULL, source INTEGER NOT NULL,
  asset_id TEXT, media_type TEXT, width INTEGER, height INTEGER, cell_span REAL,
  overviews BLOB NOT NULL, band_indices BLOB NOT NULL, path BLOB NOT NULL,
  common INTEGER NOT NULL, default_style TEXT, presets BLOB NOT NULL, examples BLOB NOT NULL,
  geometries BLOB NOT NULL,
  PRIMARY KEY(map_id,revision,ordinal), UNIQUE(map_id,revision,id),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map_bands (
  map_id BLOB NOT NULL, revision BLOB NOT NULL, layer INTEGER NOT NULL, ordinal INTEGER NOT NULL,
  id TEXT NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL, display_unit TEXT NOT NULL,
  display_factor REAL NOT NULL, nodata REAL, range_low REAL, range_high REAL,
  PRIMARY KEY(map_id,revision,layer,ordinal),
  FOREIGN KEY(map_id,revision,layer) REFERENCES map_layers(map_id,revision,ordinal) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map_categories (
  map_id BLOB NOT NULL, revision BLOB NOT NULL, layer INTEGER NOT NULL, band INTEGER NOT NULL,
  ordinal INTEGER NOT NULL, value INTEGER NOT NULL, label TEXT NOT NULL, color TEXT,
  present INTEGER NOT NULL, soluble INTEGER, bathymetric INTEGER, tint REAL, system TEXT,
  system_name TEXT,
  PRIMARY KEY(map_id,revision,layer,band,ordinal),
  FOREIGN KEY(map_id,revision,layer,band) REFERENCES map_bands(map_id,revision,layer,ordinal) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map_feature_types (
  map_id BLOB NOT NULL, revision BLOB NOT NULL, layer INTEGER NOT NULL, ordinal INTEGER NOT NULL,
  id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, path BLOB NOT NULL,
  magic_depiction INTEGER, count INTEGER NOT NULL, geometries BLOB NOT NULL,
  footprints INTEGER NOT NULL, size_least REAL, size_typical REAL, size_largest REAL,
  size_elongation REAL, size_round INTEGER, search TEXT NOT NULL,
  PRIMARY KEY(map_id,revision,layer,ordinal), UNIQUE(map_id,revision,layer,id),
  FOREIGN KEY(map_id,revision,layer) REFERENCES map_layers(map_id,revision,ordinal) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map_layer_properties (
  map_id BLOB NOT NULL, revision BLOB NOT NULL, layer INTEGER NOT NULL, name TEXT NOT NULL,
  kind INTEGER NOT NULL,
  PRIMARY KEY(map_id,revision,layer,name),
  FOREIGN KEY(map_id,revision,layer) REFERENCES map_layers(map_id,revision,ordinal) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map_registry_columns (
  map_id BLOB NOT NULL, revision BLOB NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL,
  numeric INTEGER NOT NULL, ordinal INTEGER NOT NULL,
  PRIMARY KEY(map_id,revision,key),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map_features (
  row_id INTEGER PRIMARY KEY, map_id BLOB NOT NULL, revision BLOB NOT NULL, id BLOB NOT NULL,
  space_id BLOB NOT NULL, layer_id TEXT NOT NULL, type_id TEXT NOT NULL, kind TEXT NOT NULL,
  name TEXT, entity_id BLOB, origin TEXT NOT NULL, map_only INTEGER NOT NULL,
  geometry BLOB NOT NULL, footprint BLOB, attributes TEXT NOT NULL, catalog TEXT NOT NULL,
  causes BLOB NOT NULL,
  UNIQUE(map_id,revision,id),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS map_feature_scope ON map_features(map_id,revision,space_id,layer_id,id);
CREATE INDEX IF NOT EXISTS map_from_place ON map_features(map_id,revision,json_extract(attributes,'$.fromPlace'));
CREATE INDEX IF NOT EXISTS map_to_place ON map_features(map_id,revision,json_extract(attributes,'$.toPlace'));
CREATE INDEX IF NOT EXISTS map_at_place ON map_features(map_id,revision,json_extract(attributes,'$.atPlace'));
CREATE TABLE IF NOT EXISTS map_relations (
  map_id BLOB NOT NULL, revision BLOB NOT NULL, feature_id BLOB NOT NULL, ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL, target_id BLOB NOT NULL, target_map_id BLOB, target_name TEXT NOT NULL,
  PRIMARY KEY(map_id,revision,feature_id,ordinal),
  FOREIGN KEY(map_id,revision,feature_id) REFERENCES map_features(map_id,revision,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS map_relation_target ON map_relations(map_id,revision,target_id,kind);
CREATE VIRTUAL TABLE IF NOT EXISTS map_feature_bounds USING rtree(row_id,min_x,max_x,min_y,max_y);
CREATE VIRTUAL TABLE IF NOT EXISTS map_footprint_bounds USING rtree(row_id,min_x,max_x,min_y,max_y);
CREATE TRIGGER IF NOT EXISTS map_feature_remove AFTER DELETE ON map_features BEGIN
  DELETE FROM map_feature_bounds WHERE row_id=old.row_id;
  DELETE FROM map_footprint_bounds WHERE row_id=old.row_id;
END;
CREATE TABLE IF NOT EXISTS map_samples (
  row_id INTEGER PRIMARY KEY, map_id BLOB NOT NULL, revision BLOB NOT NULL,
  id TEXT NOT NULL, space_id BLOB NOT NULL, geometry BLOB NOT NULL,
  window_west REAL NOT NULL, window_south REAL NOT NULL, window_east REAL NOT NULL,
  window_north REAL NOT NULL, closed_east INTEGER NOT NULL, closed_north INTEGER NOT NULL,
  cell_span REAL NOT NULL, center_x REAL NOT NULL, center_y REAL NOT NULL, center_z REAL,
  measure REAL NOT NULL, active INTEGER NOT NULL, sections TEXT,
  UNIQUE(map_id,revision,id),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS map_sample_scope ON map_samples(map_id,revision,space_id,id);
CREATE VIRTUAL TABLE IF NOT EXISTS map_sample_bounds USING rtree(row_id,min_x,max_x,min_y,max_y);
CREATE TRIGGER IF NOT EXISTS map_sample_remove AFTER DELETE ON map_samples BEGIN
  DELETE FROM map_sample_bounds WHERE row_id=old.row_id;
END;
CREATE TABLE IF NOT EXISTS map_history (
  map_id BLOB NOT NULL, revision BLOB NOT NULL, id BLOB NOT NULL, data BLOB NOT NULL,
  PRIMARY KEY(map_id,revision,id),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map_history_features (
  map_id BLOB NOT NULL, revision BLOB NOT NULL, history_id BLOB NOT NULL, feature_id BLOB NOT NULL,
  PRIMARY KEY(map_id,revision,feature_id,history_id),
  FOREIGN KEY(map_id,revision,history_id) REFERENCES map_history(map_id,revision,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map_assets (
  map_id BLOB NOT NULL, revision BLOB NOT NULL, id TEXT NOT NULL, media_type TEXT NOT NULL,
  location TEXT NOT NULL, byte_length INTEGER NOT NULL, illustration INTEGER NOT NULL,
  PRIMARY KEY(map_id,revision,id),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
-- Undo steps of an authored real-scale map; data holds the features before and after.
CREATE TABLE IF NOT EXISTS map_edits (
  map_id BLOB NOT NULL, revision BLOB NOT NULL, sequence INTEGER NOT NULL, label TEXT NOT NULL,
  undone INTEGER NOT NULL, data BLOB NOT NULL,
  PRIMARY KEY(map_id,revision,sequence),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS map_entities (
  map_id BLOB NOT NULL, revision BLOB NOT NULL, id BLOB NOT NULL, data BLOB NOT NULL,
  PRIMARY KEY(map_id,revision,id),
  FOREIGN KEY(map_id,revision) REFERENCES maps(map_id,revision) ON DELETE CASCADE
);
