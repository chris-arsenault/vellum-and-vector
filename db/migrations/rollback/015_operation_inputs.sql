DO $$ DECLARE table_name text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['atlas_operation_parameters','atlas_operation_inputs','atlas_operation_scopes',
        'atlas_operation_changes','atlas_operation_world_changes'] LOOP
        EXECUTE format('DROP TRIGGER operation_sealed ON %I',table_name);
    END LOOP;
END $$;
DROP TRIGGER atlas_operation_immutable ON atlas_operations;
DROP FUNCTION atlas_guard_operation_rows();
DROP TABLE atlas_operation_world_changes,atlas_operation_scopes,atlas_operation_inputs,atlas_operation_parameters;
ALTER TABLE atlas_operation_changes DROP CONSTRAINT atlas_operation_change_before_owner,DROP CONSTRAINT atlas_operation_change_after_owner;
ALTER TABLE atlas_operations DROP COLUMN sealed,DROP COLUMN command_version;
