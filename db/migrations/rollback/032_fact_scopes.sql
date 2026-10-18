DO $$ BEGIN
  IF EXISTS(SELECT FROM atlas_invalidations WHERE scope_kind='world') THEN
    RAISE EXCEPTION 'World-scoped invalidations require an explicit preservation transition before downgrade';
  END IF;
END $$;
DROP INDEX atlas_invalidations_world_fact;
ALTER TABLE atlas_invalidations DROP CONSTRAINT atlas_invalidation_scope;
ALTER TABLE atlas_invalidations ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE atlas_invalidations ALTER COLUMN footprint SET NOT NULL;
ALTER TABLE atlas_invalidations DROP COLUMN scope_kind;
