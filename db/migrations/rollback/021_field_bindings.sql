DO $$ BEGIN
    IF EXISTS(SELECT FROM atlas_field_references WHERE resource_id IS NOT NULL) OR EXISTS(SELECT FROM atlas_field_patches) THEN
        RAISE EXCEPTION 'Export resource-backed fields and authored patches before downgrading their storage';
    END IF;
END $$;
DROP TABLE atlas_field_patches;
ALTER TABLE atlas_field_references DROP COLUMN resource_id,DROP COLUMN state;
ALTER TABLE atlas_field_references ADD FOREIGN KEY(id) REFERENCES atlas_fields(id) DEFERRABLE INITIALLY DEFERRED;
