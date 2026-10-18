DROP TRIGGER atlas_run_sealed ON atlas_runs;
DROP FUNCTION atlas_require_sealed_run();
ALTER TABLE atlas_runs DROP CONSTRAINT atlas_run_profile_workflow;
ALTER TABLE atlas_profile_workflows DROP CONSTRAINT atlas_profile_workflow_identity;
DROP TRIGGER atlas_profile_version_immutable ON atlas_profile_workflows;
DROP TRIGGER atlas_process_version_immutable ON atlas_process_versions;
DROP FUNCTION atlas_guard_version_change();
DROP TRIGGER atlas_workflow_seal ON atlas_workflow_versions;
DROP FUNCTION atlas_validate_workflow_seal();
DROP TABLE atlas_world_workflow_parameters, atlas_materialized_coverage;
ALTER TABLE atlas_representations DROP COLUMN scope_id;
ALTER TABLE atlas_features DROP CONSTRAINT atlas_features_scope_id_revision_id_key;
DO $$ DECLARE table_name text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['atlas_areas','atlas_layers','atlas_features','atlas_entities',
        'atlas_connections','atlas_nodes','atlas_reaches','atlas_magic','atlas_views','atlas_field_references',
        'atlas_generations','atlas_water_transfers','atlas_world_templates','atlas_area_workflows','atlas_relations'] LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',table_name,table_name||'_revision_owner');
    END LOOP;
    FOREACH table_name IN ARRAY ARRAY['atlas_areas','atlas_layers','atlas_features','atlas_entities',
        'atlas_connections','atlas_nodes','atlas_reaches','atlas_magic','atlas_views','atlas_field_references',
        'atlas_generations','atlas_water_transfers','atlas_world_templates','atlas_area_workflows'] LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',table_name,table_name||'_validity');
    END LOOP;
END $$;
ALTER TABLE atlas_revision_owners DROP CONSTRAINT atlas_revision_owners_scope_id_id_key;
