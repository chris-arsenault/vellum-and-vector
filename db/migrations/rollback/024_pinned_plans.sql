DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['atlas_run_plan_nodes','atlas_run_write_scopes','atlas_run_input_revisions','atlas_run_inputs'] LOOP
        EXECUTE format('DROP TRIGGER run_plan_sealed ON %I',t);
    END LOOP;
END $$;
DROP FUNCTION atlas_guard_run_plan_rows();
DROP TRIGGER atlas_run_plan_immutable ON atlas_runs;
DROP FUNCTION atlas_guard_run_plan();
ALTER TABLE atlas_runs DROP COLUMN plan_sealed;
-- Retain world identities: application history may reference them.
