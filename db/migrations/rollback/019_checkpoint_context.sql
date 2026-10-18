DROP TABLE atlas_checkpoint_diagnostics;
ALTER TABLE atlas_checkpoint_iterations DROP COLUMN workflow_id,DROP COLUMN workflow_version;
ALTER TABLE atlas_checkpoint_nodes DROP COLUMN ordinal,DROP COLUMN has_output;
ALTER TABLE atlas_run_checkpoints DROP COLUMN workflow_scope,DROP COLUMN workflow_id,DROP COLUMN workflow_version;
