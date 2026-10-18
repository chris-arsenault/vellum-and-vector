ALTER TABLE atlas_field_references ADD COLUMN source_run_id uuid, ADD COLUMN source_operation_id uuid;
UPDATE atlas_field_references f SET source_run_id=r.id FROM atlas_runs r WHERE r.world_id=f.scope_id AND r.id=f.job_id;
UPDATE atlas_field_references f SET source_operation_id=o.operation_id FROM atlas_operations o
    WHERE o.world_id=f.scope_id AND o.operation_id=f.job_id AND f.source_run_id IS NULL;
DO $$ BEGIN
    IF EXISTS(SELECT FROM atlas_field_references WHERE source_run_id IS NULL AND source_operation_id IS NULL) THEN
        RAISE EXCEPTION 'Retained prototype field creators require an explicit run/operation import transition';
    END IF;
END $$;
ALTER TABLE atlas_field_references ADD FOREIGN KEY(scope_id,source_run_id) REFERENCES atlas_runs(world_id,id),
    ADD FOREIGN KEY(scope_id,source_operation_id) REFERENCES atlas_operations(world_id,operation_id) DEFERRABLE INITIALLY DEFERRED,
    ADD CHECK(num_nonnulls(source_run_id,source_operation_id)=1), DROP COLUMN job_id;
