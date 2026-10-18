DO $$ BEGIN
  IF EXISTS(SELECT FROM atlas_checkpoint_frames) OR EXISTS(SELECT FROM atlas_run_output_selection) THEN
    RAISE EXCEPTION 'Retained execution frames require an explicit preservation transition before downgrade';
  END IF;
END $$;
DROP TABLE atlas_checkpoint_fact_effects,atlas_checkpoint_domain_reads,atlas_checkpoint_domain_bindings,atlas_checkpoint_node_execution,atlas_checkpoint_frames;
DROP TABLE atlas_run_output_ports,atlas_run_output_selection;
ALTER TABLE atlas_checkpoint_resources DROP CONSTRAINT atlas_checkpoint_resources_role_check;
ALTER TABLE atlas_checkpoint_resources ADD CHECK(role IN ('artifact','output','feedback','working'));
ALTER TABLE atlas_workflow_feedback DROP COLUMN accumulator_process,DROP COLUMN accumulator_version;
ALTER TABLE atlas_workflow_ports DROP COLUMN time_policy;
