DROP TRIGGER atlas_checkpoint_immutable ON atlas_run_checkpoints;
DO $$ DECLARE table_name text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['atlas_checkpoint_nodes','atlas_checkpoint_random','atlas_checkpoint_iterations',
        'atlas_checkpoint_resources','atlas_checkpoint_causes','atlas_checkpoint_invalidations'] LOOP
        EXECUTE format('DROP TRIGGER checkpoint_sealed ON %I',table_name);
    END LOOP;
    FOREACH table_name IN ARRAY ARRAY['atlas_grid_channels','atlas_grid_water_bodies','atlas_grid_lake_slices'] LOOP
        EXECUTE format('DROP TRIGGER artifact_sealed ON %I',table_name);
    END LOOP;
    FOREACH table_name IN ARRAY ARRAY['atlas_areas','atlas_layers','atlas_features','atlas_entities',
        'atlas_connections','atlas_nodes','atlas_reaches','atlas_magic','atlas_views','atlas_field_references',
        'atlas_generations','atlas_water_transfers','atlas_world_templates','atlas_area_workflows'] LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',table_name,table_name||'_revision_overlap');
    END LOOP;
END $$;
DROP TRIGGER atlas_grid_immutable ON atlas_grids;
DROP TRIGGER atlas_value_set_immutable ON atlas_value_sets;
DROP TRIGGER atlas_value_immutable ON atlas_values;
DROP FUNCTION atlas_guard_sealed_values(), atlas_guard_sealed_root(), atlas_guard_sealed_grid_rows(), atlas_guard_sealed_checkpoint_rows();
ALTER TABLE atlas_run_checkpoints DROP COLUMN sealed;
ALTER TABLE atlas_grid_channels DROP CONSTRAINT atlas_channel_finite;
ALTER TABLE atlas_grids DROP CONSTRAINT atlas_bounds_finite, DROP CONSTRAINT atlas_measures_finite;
DROP FUNCTION atlas_finite_array(double precision[]);
DROP TABLE atlas_resource_events, atlas_resource_history, atlas_resource_reaches, atlas_resource_nodes;
ALTER TABLE atlas_resource_entities DROP COLUMN world_id;
ALTER TABLE atlas_resource_features DROP COLUMN world_id;
ALTER TABLE atlas_run_inputs DROP COLUMN world_id;
ALTER TABLE atlas_run_plan_nodes DROP COLUMN world_id;
ALTER TABLE atlas_checkpoint_resources DROP COLUMN world_id;
ALTER TABLE atlas_checkpoint_iterations DROP COLUMN world_id;
ALTER TABLE atlas_checkpoint_nodes DROP COLUMN world_id;
ALTER TABLE atlas_run_checkpoints DROP COLUMN world_id;
ALTER TABLE atlas_resources DROP CONSTRAINT atlas_resources_world_id_grid_id_fkey;
ALTER TABLE atlas_grids DROP CONSTRAINT atlas_grids_world_id_id_key;
ALTER TABLE atlas_grid_channels DROP COLUMN unit;
ALTER TABLE atlas_grids DROP COLUMN resolution, DROP COLUMN time_context, DROP COLUMN crs_id,
    DROP COLUMN space_id, DROP COLUMN footprint, DROP COLUMN active, DROP COLUMN sealed;
ALTER TABLE atlas_value_sets DROP COLUMN sealed;
ALTER TABLE atlas_values DROP CONSTRAINT atlas_values_value_set_fkey;
ALTER TABLE atlas_values ADD FOREIGN KEY(value_set) REFERENCES atlas_value_sets(id);
ALTER TABLE atlas_grid_channels DROP CONSTRAINT atlas_grid_channels_grid_id_fkey;
ALTER TABLE atlas_grid_channels ADD FOREIGN KEY(grid_id) REFERENCES atlas_grids(id);
