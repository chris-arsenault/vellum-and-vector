DO $$ BEGIN
    IF EXISTS(SELECT FROM atlas_field_references WHERE source_operation_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Authored field provenance requires an explicit downgrade transition';
    END IF;
END $$;
ALTER TABLE atlas_field_references ADD COLUMN job_id uuid;
UPDATE atlas_field_references SET job_id=source_run_id;
ALTER TABLE atlas_field_references ALTER COLUMN job_id SET NOT NULL,DROP COLUMN source_operation_id,DROP COLUMN source_run_id;
