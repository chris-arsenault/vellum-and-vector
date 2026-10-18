DO $$ BEGIN
    IF EXISTS(SELECT FROM atlas_field_patches WHERE valid_to IS NOT NULL) THEN
        RAISE EXCEPTION 'Revisioned field patches require an explicit downgrade transition';
    END IF;
END $$;
DROP TABLE atlas_operation_artifacts;
DROP TRIGGER atlas_patch_identity ON atlas_field_patches;
DROP FUNCTION atlas_guard_patch_identity();
DROP INDEX atlas_field_patch_temporal;
DROP INDEX atlas_field_patches_current;
ALTER TABLE atlas_field_patches DROP CONSTRAINT atlas_field_patches_pkey;
ALTER TABLE atlas_field_patches DROP COLUMN scope_id, DROP COLUMN revision_id,
    DROP COLUMN valid_from,DROP COLUMN valid_to,DROP COLUMN area_id,DROP COLUMN space_id,DROP COLUMN created_version;
ALTER TABLE atlas_field_patches ADD PRIMARY KEY(id);
