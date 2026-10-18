DROP TABLE atlas_template_instance_members, atlas_invalidations, atlas_operation_changes,
    atlas_run_inputs, atlas_run_diagnostics;
ALTER TABLE atlas_runs DROP CONSTRAINT atlas_runs_id_checkpoint_id_fkey;
ALTER TABLE atlas_runs DROP COLUMN checkpoint_id;
DROP TABLE atlas_checkpoint_invalidations, atlas_checkpoint_causes, atlas_checkpoint_resources,
    atlas_checkpoint_iterations, atlas_checkpoint_random, atlas_checkpoint_nodes, atlas_run_checkpoints,
    atlas_resource_connections, atlas_resource_relations, atlas_resource_entities, atlas_resource_features,
    atlas_resource_lineage, atlas_resource_facts, atlas_resources, atlas_run_input_revisions,
    atlas_run_write_scopes, atlas_run_plan_nodes, atlas_runs;
