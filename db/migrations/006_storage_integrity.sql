ALTER TABLE atlas_value_sets ADD COLUMN sealed boolean NOT NULL DEFAULT false;
ALTER TABLE atlas_grids ADD COLUMN sealed boolean NOT NULL DEFAULT false;
ALTER TABLE atlas_grids ADD COLUMN active boolean[];
ALTER TABLE atlas_grids ADD COLUMN footprint geometry;
ALTER TABLE atlas_grids ADD COLUMN space_id uuid;
ALTER TABLE atlas_grids ADD COLUMN crs_id text;
ALTER TABLE atlas_grids ADD COLUMN time_context text;
ALTER TABLE atlas_grids ADD COLUMN resolution double precision;
ALTER TABLE atlas_grid_channels ADD COLUMN unit text NOT NULL DEFAULT 'index';
UPDATE atlas_grids SET sealed=true;
ALTER TABLE atlas_grids ADD CONSTRAINT atlas_grid_mask_length CHECK(active IS NULL OR cardinality(active)=width*height);
ALTER TABLE atlas_grids ADD CONSTRAINT atlas_grid_footprint_valid CHECK(footprint IS NULL OR (ST_SRID(footprint)=0 AND ST_IsValid(footprint) AND NOT ST_IsEmpty(footprint)));
ALTER TABLE atlas_grids ADD UNIQUE(world_id,id);
ALTER TABLE atlas_resources ADD FOREIGN KEY(world_id,grid_id) REFERENCES atlas_grids(world_id,id);

ALTER TABLE atlas_run_checkpoints ADD COLUMN world_id uuid NOT NULL;
ALTER TABLE atlas_run_checkpoints ADD FOREIGN KEY(world_id,run_id) REFERENCES atlas_runs(world_id,id);
ALTER TABLE atlas_run_checkpoints ADD UNIQUE(world_id,id);
ALTER TABLE atlas_checkpoint_nodes ADD COLUMN world_id uuid NOT NULL;
ALTER TABLE atlas_checkpoint_nodes ADD FOREIGN KEY(world_id,checkpoint_id) REFERENCES atlas_run_checkpoints(world_id,id);
ALTER TABLE atlas_checkpoint_nodes ADD FOREIGN KEY(world_id,state_values) REFERENCES atlas_value_sets(scope_id,id);
ALTER TABLE atlas_checkpoint_nodes ADD FOREIGN KEY(world_id,child_checkpoint) REFERENCES atlas_run_checkpoints(world_id,id);
ALTER TABLE atlas_checkpoint_iterations ADD COLUMN world_id uuid NOT NULL;
ALTER TABLE atlas_checkpoint_iterations ADD FOREIGN KEY(world_id,checkpoint_id) REFERENCES atlas_run_checkpoints(world_id,id);
ALTER TABLE atlas_checkpoint_iterations ADD FOREIGN KEY(world_id,variables) REFERENCES atlas_value_sets(scope_id,id);
ALTER TABLE atlas_checkpoint_resources ADD COLUMN world_id uuid NOT NULL;
ALTER TABLE atlas_checkpoint_resources ADD FOREIGN KEY(world_id,checkpoint_id) REFERENCES atlas_run_checkpoints(world_id,id);
ALTER TABLE atlas_checkpoint_resources ADD FOREIGN KEY(world_id,resource_id) REFERENCES atlas_resources(world_id,id);
ALTER TABLE atlas_run_plan_nodes ADD COLUMN world_id uuid NOT NULL;
ALTER TABLE atlas_run_plan_nodes ADD FOREIGN KEY(world_id,run_id) REFERENCES atlas_runs(world_id,id);
ALTER TABLE atlas_run_plan_nodes ADD FOREIGN KEY(world_id,parameters) REFERENCES atlas_value_sets(scope_id,id);
ALTER TABLE atlas_run_inputs ADD COLUMN world_id uuid NOT NULL;
ALTER TABLE atlas_run_inputs ADD FOREIGN KEY(world_id,run_id) REFERENCES atlas_runs(world_id,id);
ALTER TABLE atlas_run_inputs ADD FOREIGN KEY(world_id,resource_id) REFERENCES atlas_resources(world_id,id);
ALTER TABLE atlas_resource_features ADD COLUMN world_id uuid NOT NULL;
ALTER TABLE atlas_resource_features ADD FOREIGN KEY(world_id,resource_id) REFERENCES atlas_resources(world_id,id);
ALTER TABLE atlas_resource_features ADD FOREIGN KEY(world_id,area_id) REFERENCES atlas_objects(scope_id,id);
ALTER TABLE atlas_resource_features ADD FOREIGN KEY(world_id,attributes) REFERENCES atlas_value_sets(scope_id,id);
ALTER TABLE atlas_resource_entities ADD COLUMN world_id uuid NOT NULL;
ALTER TABLE atlas_resource_entities ADD FOREIGN KEY(world_id,resource_id) REFERENCES atlas_resources(world_id,id);
ALTER TABLE atlas_resource_entities ADD FOREIGN KEY(world_id,attributes) REFERENCES atlas_value_sets(scope_id,id);
CREATE TABLE atlas_resource_nodes (
    world_id uuid NOT NULL, resource_id uuid NOT NULL, id uuid NOT NULL, kind text NOT NULL,
    space_id uuid NOT NULL, x double precision NOT NULL, y double precision NOT NULL, z double precision NOT NULL,
    PRIMARY KEY(resource_id,id), FOREIGN KEY(world_id,resource_id) REFERENCES atlas_resources(world_id,id)
);
CREATE TABLE atlas_resource_reaches (
    world_id uuid NOT NULL, resource_id uuid NOT NULL, id uuid NOT NULL, feature_id uuid NOT NULL,
    start_id uuid NOT NULL, end_id uuid NOT NULL, geometry geometry NOT NULL, flow double precision NOT NULL,
    PRIMARY KEY(resource_id,id), FOREIGN KEY(world_id,resource_id) REFERENCES atlas_resources(world_id,id),
    FOREIGN KEY(resource_id,start_id) REFERENCES atlas_resource_nodes(resource_id,id),
    FOREIGN KEY(resource_id,end_id) REFERENCES atlas_resource_nodes(resource_id,id),
    CHECK(ST_SRID(geometry)=0 AND ST_IsValid(geometry) AND NOT ST_IsEmpty(geometry))
);
CREATE TABLE atlas_resource_history (
    world_id uuid NOT NULL, resource_id uuid PRIMARY KEY, epoch_id text NOT NULL,
    duration double precision NOT NULL CHECK(duration>=0), parent_epoch text,
    parent_resource uuid, previous_resource uuid,
    FOREIGN KEY(world_id,resource_id) REFERENCES atlas_resources(world_id,id),
    FOREIGN KEY(world_id,parent_resource) REFERENCES atlas_resources(world_id,id),
    FOREIGN KEY(world_id,previous_resource) REFERENCES atlas_resources(world_id,id)
);
CREATE TABLE atlas_resource_events (
    world_id uuid NOT NULL, resource_id uuid NOT NULL, ordinal integer NOT NULL, id uuid NOT NULL,
    kind text NOT NULL, subject_id uuid, epoch_id text NOT NULL,
    x double precision NOT NULL, y double precision NOT NULL, z double precision NOT NULL,
    amount double precision NOT NULL, unit text NOT NULL, causes text[] NOT NULL,
    PRIMARY KEY(resource_id,id), UNIQUE(resource_id,ordinal),
    FOREIGN KEY(world_id,resource_id) REFERENCES atlas_resources(world_id,id)
);

-- Prevent overlaps in historical validity as well as duplicate current rows.
DO $$ DECLARE table_name text; id_column text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['atlas_areas','atlas_layers','atlas_features','atlas_entities',
        'atlas_connections','atlas_nodes','atlas_reaches','atlas_magic','atlas_views','atlas_field_references',
        'atlas_generations','atlas_water_transfers','atlas_world_templates','atlas_area_workflows'] LOOP
        id_column:=CASE WHEN table_name='atlas_area_workflows' THEN 'area_id' ELSE 'id' END;
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I EXCLUDE USING gist (scope_id WITH =, %I WITH =, int8range(valid_from,valid_to,''[)'') WITH &&)',
            table_name,table_name||'_revision_overlap',id_column);
    END LOOP;
END $$;

CREATE FUNCTION atlas_finite_array(channel_values double precision[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT array_ndims(channel_values)=1 AND NOT EXISTS(SELECT FROM unnest(channel_values) AS value
        WHERE value IS NULL OR NOT(value>'-Infinity'::float8 AND value<'Infinity'::float8))
$$;
ALTER TABLE atlas_grid_channels ADD CONSTRAINT atlas_channel_finite CHECK(atlas_finite_array(values));
ALTER TABLE atlas_grids ADD CONSTRAINT atlas_bounds_finite CHECK(atlas_finite_array(bounds));
ALTER TABLE atlas_grids ADD CONSTRAINT atlas_measures_finite CHECK(measures IS NULL OR (atlas_finite_array(measures) AND 0<=ALL(measures)));

CREATE FUNCTION atlas_guard_sealed_values() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS(SELECT FROM atlas_value_sets WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.value_set ELSE NEW.value_set END AND sealed) OR
       (TG_OP='UPDATE' AND EXISTS(SELECT FROM atlas_value_sets WHERE id=OLD.value_set AND sealed)) THEN
        RAISE EXCEPTION 'Sealed values are immutable';
    END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER atlas_value_immutable BEFORE INSERT OR UPDATE OR DELETE ON atlas_values
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_values();
CREATE FUNCTION atlas_guard_sealed_root() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.sealed THEN RAISE EXCEPTION 'Sealed records are immutable'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER atlas_value_set_immutable BEFORE UPDATE ON atlas_value_sets
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_root();
CREATE TRIGGER atlas_grid_immutable BEFORE UPDATE ON atlas_grids
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_root();
CREATE FUNCTION atlas_guard_sealed_grid_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS(SELECT FROM atlas_grids WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.grid_id ELSE NEW.grid_id END AND sealed) OR
       (TG_OP='UPDATE' AND EXISTS(SELECT FROM atlas_grids WHERE id=OLD.grid_id AND sealed)) THEN
        RAISE EXCEPTION 'Sealed numerical artifacts are immutable';
    END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE table_name text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['atlas_grid_channels','atlas_grid_water_bodies','atlas_grid_lake_slices'] LOOP
        EXECUTE format('CREATE TRIGGER artifact_sealed BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_grid_rows()',table_name);
    END LOOP;
END $$;
ALTER TABLE atlas_run_checkpoints ADD COLUMN sealed boolean NOT NULL DEFAULT false;
CREATE TRIGGER atlas_checkpoint_immutable BEFORE UPDATE ON atlas_run_checkpoints
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_root();
CREATE FUNCTION atlas_guard_sealed_checkpoint_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS(SELECT FROM atlas_run_checkpoints WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.checkpoint_id ELSE NEW.checkpoint_id END AND sealed) OR
       (TG_OP='UPDATE' AND EXISTS(SELECT FROM atlas_run_checkpoints WHERE id=OLD.checkpoint_id AND sealed)) THEN
        RAISE EXCEPTION 'Sealed checkpoints are immutable';
    END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE table_name text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['atlas_checkpoint_nodes','atlas_checkpoint_random','atlas_checkpoint_iterations',
        'atlas_checkpoint_resources','atlas_checkpoint_causes','atlas_checkpoint_invalidations'] LOOP
        EXECUTE format('CREATE TRIGGER checkpoint_sealed BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_checkpoint_rows()',table_name);
    END LOOP;
END $$;

ALTER TABLE atlas_values DROP CONSTRAINT atlas_values_value_set_fkey;
ALTER TABLE atlas_values ADD FOREIGN KEY(value_set) REFERENCES atlas_value_sets(id) ON DELETE CASCADE;
ALTER TABLE atlas_grid_channels DROP CONSTRAINT atlas_grid_channels_grid_id_fkey;
ALTER TABLE atlas_grid_channels ADD FOREIGN KEY(grid_id) REFERENCES atlas_grids(id) ON DELETE CASCADE;
