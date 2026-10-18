ALTER TABLE atlas_invalidations ADD COLUMN scope_kind text NOT NULL DEFAULT 'spatial';
ALTER TABLE atlas_invalidations ALTER COLUMN space_id DROP NOT NULL;
ALTER TABLE atlas_invalidations ALTER COLUMN footprint DROP NOT NULL;
ALTER TABLE atlas_invalidations ADD CONSTRAINT atlas_invalidation_scope CHECK (
  (scope_kind='world' AND space_id IS NULL AND footprint IS NULL) OR
  (scope_kind='spatial' AND space_id IS NOT NULL AND footprint IS NOT NULL)
);
CREATE INDEX atlas_invalidations_world_fact ON atlas_invalidations(world_id,fact,version)
  WHERE scope_kind='world' AND resolved_at_version IS NULL;
