-- The prototype execution graph has never been deployed. Refuse to discard any
-- retained configuration/job data if this migration is used on a development DB.
DO $$ BEGIN
    IF EXISTS(SELECT FROM atlas_runs) OR EXISTS(SELECT FROM atlas_workflow_versions)
       OR EXISTS(SELECT FROM atlas_resources WHERE kind<>'field')
       OR EXISTS(SELECT FROM atlas_fields)
       OR EXISTS(SELECT FROM atlas_field_references WHERE resource_id IS NULL) THEN
        RAISE EXCEPTION 'Retained prototype jobs/configuration require an explicit import before replacing generation storage';
    END IF;
END $$;

-- The old field simulator stored separate protection/epoch/budget copies.
-- Authored patches and immutable numerical artifacts now own those data paths.
DROP TABLE atlas_field_human_epochs,atlas_field_transfers,atlas_field_budgets,atlas_field_links,
    atlas_field_epochs,atlas_field_protections,atlas_fields;
DROP TYPE atlas_field_boundary,atlas_budget,atlas_human_event;

DROP TRIGGER atlas_run_sealed ON atlas_runs;
DROP TRIGGER atlas_run_plan_immutable ON atlas_runs;
DROP FUNCTION atlas_require_sealed_run(),atlas_guard_run_plan(),atlas_guard_run_plan_rows() CASCADE;
ALTER TABLE atlas_runs DROP COLUMN checkpoint_id;
DROP TABLE atlas_checkpoint_fact_effects,atlas_checkpoint_domain_reads,atlas_checkpoint_domain_bindings,
    atlas_checkpoint_node_execution,atlas_checkpoint_frames,atlas_checkpoint_diagnostics,
    atlas_checkpoint_causes,atlas_checkpoint_invalidations,atlas_checkpoint_resources,
    atlas_checkpoint_iterations,atlas_checkpoint_random,atlas_checkpoint_nodes,atlas_run_checkpoints;
DROP FUNCTION atlas_guard_sealed_checkpoint_rows();
DROP TABLE atlas_run_output_ports,atlas_run_output_selection,atlas_run_inputs,atlas_run_plan_nodes,
    atlas_run_write_scopes,atlas_run_diagnostics;
ALTER TABLE atlas_runs DROP COLUMN workflow_scope,DROP COLUMN workflow_id,DROP COLUMN workflow_version,
    DROP COLUMN profile_version,DROP COLUMN plan_hash,DROP COLUMN lease_owner,DROP COLUMN lease_expires,
    DROP COLUMN plan_sealed,
    ADD COLUMN configuration_id text NOT NULL,ADD COLUMN configuration_version integer NOT NULL CHECK(configuration_version>0),
    ADD COLUMN output_layers text[] NOT NULL;
DROP TABLE atlas_template_workflows,atlas_area_workflows,atlas_world_workflow_parameters,
    atlas_profile_workflows,atlas_workflow_epoch_bindings,atlas_workflow_defaults,atlas_workflow_epochs,
    atlas_workflow_feedback,atlas_workflow_bindings,atlas_parameter_definitions,
    atlas_workflow_port_channels,atlas_workflow_ports,atlas_workflow_order_edges,atlas_workflow_nodes,
    atlas_workflow_versions,atlas_process_versions;
DROP FUNCTION atlas_guard_sealed_workflow(),atlas_validate_workflow_seal();

-- A template recipe selects versioned application configuration and overrides;
-- implementation/process contracts remain ordinary TypeScript registrations.
CREATE TABLE atlas_template_workflows (
    definition_scope uuid PRIMARY KEY REFERENCES atlas_template_definitions(scope_id),
    workflow_scope uuid NOT NULL REFERENCES atlas_scopes(id),workflow_id text NOT NULL,
    workflow_version bigint NOT NULL CHECK(workflow_version>0),parameters uuid NOT NULL,
    FOREIGN KEY(definition_scope,parameters) REFERENCES atlas_value_sets(scope_id,id)
);

-- Configuration is a sequence tree plus epoch schedules, not a persisted program
-- of ports, binding expressions, continuation frames and implementation contracts.
CREATE TABLE atlas_run_steps (
    run_id uuid NOT NULL REFERENCES atlas_runs(id),path text[] NOT NULL,ordinal integer NOT NULL CHECK(ordinal>=0),
    kind text NOT NULL CHECK(kind IN ('process','epochs')),process_id text,process_version text,
    parameters uuid REFERENCES atlas_value_sets(id),when_variable text,when_value uuid REFERENCES atlas_value_sets(id),
    reset_facts text[] NOT NULL DEFAULT '{}',
    PRIMARY KEY(run_id,path),CHECK(cardinality(path)>0),
    CHECK((kind='process' AND process_id IS NOT NULL AND process_version IS NOT NULL) OR
          (kind='epochs' AND process_id IS NULL AND process_version IS NULL AND parameters IS NULL AND when_variable IS NULL)),
    CHECK((when_variable IS NULL)=(when_value IS NULL))
);
CREATE TABLE atlas_run_epochs (
    run_id uuid NOT NULL,path text[] NOT NULL,ordinal integer NOT NULL CHECK(ordinal>=0),id text NOT NULL,
    duration double precision NOT NULL CHECK(duration>=0 AND duration<'Infinity'::float8),
    parent_epoch text,variables uuid NOT NULL REFERENCES atlas_value_sets(id),
    PRIMARY KEY(run_id,path,id),UNIQUE(run_id,path,ordinal),
    FOREIGN KEY(run_id,path) REFERENCES atlas_run_steps(run_id,path)
);
CREATE FUNCTION atlas_guard_job_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.id,NEW.world_id,NEW.operation_id,NEW.actor,NEW.request_hash,NEW.input_version,
       NEW.area_id,NEW.space_id,NEW.footprint,NEW.crs_id,NEW.time_context,NEW.resolution,
       NEW.profile,NEW.variant,NEW.parameters,NEW.seed,NEW.seed_scope,NEW.configuration_id,
       NEW.configuration_version,NEW.output_layers,NEW.created_at) IS DISTINCT FROM
       ROW(OLD.id,OLD.world_id,OLD.operation_id,OLD.actor,OLD.request_hash,OLD.input_version,
       OLD.area_id,OLD.space_id,OLD.footprint,OLD.crs_id,OLD.time_context,OLD.resolution,
       OLD.profile,OLD.variant,OLD.parameters,OLD.seed,OLD.seed_scope,OLD.configuration_id,
       OLD.configuration_version,OLD.output_layers,OLD.created_at) THEN
        RAISE EXCEPTION 'Submitted job inputs are immutable';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER atlas_job_inputs_immutable BEFORE UPDATE ON atlas_runs
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_job_inputs();

-- Keep immutable authored grids and their public identities, remove the generic
-- stage/validate/publish resource state machine and duplicate domain payloads.
DROP TRIGGER atlas_resource_immutable ON atlas_resources;
ALTER TABLE atlas_resources ADD COLUMN facts text[] NOT NULL DEFAULT '{}';
UPDATE atlas_resources r SET facts=ARRAY(SELECT fact FROM atlas_resource_facts f WHERE f.resource_id=r.id ORDER BY fact);
ALTER TABLE atlas_resources RENAME TO atlas_field_artifacts;
ALTER TABLE atlas_resource_lineage RENAME TO atlas_field_sources;
ALTER TABLE atlas_field_sources ADD COLUMN world_id uuid;
UPDATE atlas_field_sources s SET world_id=r.world_id FROM atlas_field_artifacts r WHERE r.id=s.resource_id;
ALTER TABLE atlas_field_sources ALTER COLUMN world_id SET NOT NULL,
    ADD FOREIGN KEY(world_id,resource_id) REFERENCES atlas_field_artifacts(world_id,id),
    ADD FOREIGN KEY(world_id,input_id) REFERENCES atlas_field_artifacts(world_id,id);
DROP TRIGGER resource_sealed ON atlas_field_sources;
DROP TABLE atlas_resource_facts,atlas_resource_features,atlas_resource_entities,atlas_resource_relations,
    atlas_resource_connections,atlas_resource_reaches,atlas_resource_nodes,atlas_resource_events,atlas_resource_history;
DROP FUNCTION atlas_guard_resource_rows(),atlas_guard_resource_root();
ALTER TABLE atlas_field_artifacts DROP COLUMN values_id,DROP COLUMN kind,DROP COLUMN schema_id,
    DROP COLUMN schema_version,DROP COLUMN unit,DROP COLUMN status,DROP COLUMN retired_version,
    DROP COLUMN sealed,DROP COLUMN content_hash;
ALTER TABLE atlas_field_artifacts ALTER COLUMN grid_id SET NOT NULL,ALTER COLUMN published_version SET NOT NULL;
CREATE FUNCTION atlas_immutable_field_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published numerical artifacts are immutable'; END $$;
CREATE TRIGGER atlas_field_artifact_immutable BEFORE UPDATE OR DELETE ON atlas_field_artifacts
    FOR EACH ROW EXECUTE FUNCTION atlas_immutable_field_artifact();

-- History already references immutable before/after objects and field artifacts.
-- New operation parameters contain only compact command settings. Retained
-- operation inputs remain readable; this transition does not erase old history.
CREATE TABLE atlas_operation_settings (
    world_id uuid NOT NULL,operation_id uuid NOT NULL,name text NOT NULL,
    kind text NOT NULL CHECK(kind IN ('null','text','number','boolean')),
    text_value text,number_value double precision,boolean_value boolean,
    PRIMARY KEY(world_id,operation_id,name),
    FOREIGN KEY(world_id,operation_id) REFERENCES atlas_operations(world_id,operation_id),
    CHECK((kind='null' AND num_nonnulls(text_value,number_value,boolean_value)=0) OR
          (kind='text' AND text_value IS NOT NULL AND num_nonnulls(number_value,boolean_value)=0) OR
          (kind='number' AND number_value IS NOT NULL AND num_nonnulls(text_value,boolean_value)=0
           AND number_value>'-Infinity'::float8 AND number_value<'Infinity'::float8) OR
          (kind='boolean' AND boolean_value IS NOT NULL AND num_nonnulls(text_value,number_value)=0))
);
INSERT INTO atlas_operation_settings
    SELECT p.world_id,p.operation_id,v.path[1],v.kind,v.text_value,v.number_value,v.boolean_value
    FROM atlas_operation_parameters p JOIN atlas_values v ON v.value_set=p.parameters
    WHERE cardinality(v.path)=1 AND v.kind IN ('null','text','number','boolean');
CREATE TRIGGER operation_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_operation_settings
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_operation_rows();
