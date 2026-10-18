ALTER TABLE atlas_revision_owners ADD UNIQUE(scope_id,id);
DO $$ DECLARE table_name text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['atlas_areas','atlas_layers','atlas_features','atlas_entities',
        'atlas_connections','atlas_nodes','atlas_reaches','atlas_magic','atlas_views','atlas_field_references',
        'atlas_generations','atlas_water_transfers','atlas_world_templates','atlas_area_workflows','atlas_relations'] LOOP
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(scope_id,revision_id) REFERENCES atlas_revision_owners(scope_id,id)',
            table_name,table_name||'_revision_owner');
    END LOOP;
    FOREACH table_name IN ARRAY ARRAY['atlas_areas','atlas_layers','atlas_features','atlas_entities',
        'atlas_connections','atlas_nodes','atlas_reaches','atlas_magic','atlas_views','atlas_field_references',
        'atlas_generations','atlas_water_transfers','atlas_world_templates','atlas_area_workflows'] LOOP
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK(valid_from>0 AND (valid_to IS NULL OR valid_to>valid_from))',
            table_name,table_name||'_validity');
    END LOOP;
END $$;
ALTER TABLE atlas_representations ADD COLUMN scope_id uuid;
UPDATE atlas_representations r SET scope_id=f.scope_id FROM atlas_features f WHERE f.revision_id=r.feature_revision;
ALTER TABLE atlas_representations ALTER COLUMN scope_id SET NOT NULL;
ALTER TABLE atlas_representations ADD FOREIGN KEY(scope_id,revision_id) REFERENCES atlas_revision_owners(scope_id,id);
ALTER TABLE atlas_representations ADD FOREIGN KEY(scope_id,area_id) REFERENCES atlas_objects(scope_id,id);
ALTER TABLE atlas_features ADD UNIQUE(scope_id,revision_id);
ALTER TABLE atlas_representations ADD FOREIGN KEY(scope_id,feature_revision) REFERENCES atlas_features(scope_id,revision_id);
CREATE TABLE atlas_materialized_coverage (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL, id uuid NOT NULL,
    valid_from bigint NOT NULL CHECK(valid_from>0), valid_to bigint, area_id uuid NOT NULL, space_id uuid NOT NULL,
    layer_id text NOT NULL, detail_rank integer NOT NULL CHECK(detail_rank BETWEEN 0 AND 4), resolution double precision,
    time_context text NOT NULL, footprint geometry NOT NULL, state text NOT NULL
        CHECK(state IN ('unmaterialized','generated','authored','protected','intentionallyEmpty','stale')),
    resource_id uuid, generation_id uuid,
    FOREIGN KEY(scope_id,revision_id) REFERENCES atlas_revision_owners(scope_id,id),
    FOREIGN KEY(scope_id,id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(scope_id,area_id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(scope_id,resource_id) REFERENCES atlas_resources(world_id,id),
    FOREIGN KEY(scope_id,generation_id) REFERENCES atlas_runs(world_id,id),
    CHECK(valid_to IS NULL OR valid_to>valid_from),
    CHECK(resolution IS NULL OR (resolution>0 AND resolution<'Infinity'::float8)),
    CHECK(ST_SRID(footprint)=0 AND ST_IsValid(footprint) AND NOT ST_IsEmpty(footprint)),
    EXCLUDE USING gist(scope_id WITH =,id WITH =,int8range(valid_from,valid_to,'[)') WITH &&)
);
CREATE UNIQUE INDEX atlas_coverage_current ON atlas_materialized_coverage(scope_id,id) WHERE valid_to IS NULL;
CREATE INDEX atlas_coverage_extent ON atlas_materialized_coverage USING gist(scope_id,space_id,footprint) WHERE valid_to IS NULL;
CREATE INDEX atlas_coverage_layer ON atlas_materialized_coverage(scope_id,layer_id,detail_rank,time_context) WHERE valid_to IS NULL;
-- Exact same-detail ownership uses ST_Intersection in the locked publication
-- transaction. A bounding-box exclusion would incorrectly reject disjoint
-- arbitrary polygons whose envelopes overlap.
CREATE TABLE atlas_world_workflow_parameters (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL REFERENCES atlas_worlds(id),
    valid_from bigint NOT NULL CHECK(valid_from>0), valid_to bigint, parameters uuid NOT NULL,
    FOREIGN KEY(scope_id,revision_id) REFERENCES atlas_revision_owners(scope_id,id),
    FOREIGN KEY(scope_id,parameters) REFERENCES atlas_value_sets(scope_id,id),
    CHECK(valid_to IS NULL OR valid_to>valid_from),
    EXCLUDE USING gist(scope_id WITH =,int8range(valid_from,valid_to,'[)') WITH &&)
);
CREATE FUNCTION atlas_validate_workflow_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.sealed THEN
        IF EXISTS(SELECT FROM atlas_parameter_definitions p JOIN atlas_value_sets v ON v.id=p.default_values OR v.id=p.choices
            WHERE p.scope_id=NEW.scope_id AND p.workflow_id=NEW.id AND p.workflow_version=NEW.version AND NOT v.sealed) OR
           EXISTS(SELECT FROM atlas_workflow_bindings b JOIN atlas_value_sets v ON v.id=b.literal_values OR v.id=b.comparison_values
            WHERE b.scope_id=NEW.scope_id AND b.workflow_id=NEW.id AND b.workflow_version=NEW.version AND NOT v.sealed) OR
           EXISTS(SELECT FROM atlas_workflow_epochs e JOIN atlas_value_sets v ON v.id=e.variables
            WHERE e.scope_id=NEW.scope_id AND e.workflow_id=NEW.id AND e.workflow_version=NEW.version AND NOT v.sealed) OR
           EXISTS(SELECT FROM atlas_workflow_defaults d JOIN atlas_value_sets v ON v.id=d.variables
            WHERE d.scope_id=NEW.scope_id AND d.workflow_id=NEW.id AND d.workflow_version=NEW.version AND NOT v.sealed) THEN
            RAISE EXCEPTION 'Workflow values must be sealed before the definition';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER atlas_workflow_seal BEFORE INSERT OR UPDATE ON atlas_workflow_versions
    FOR EACH ROW EXECUTE FUNCTION atlas_validate_workflow_seal();
CREATE FUNCTION atlas_guard_version_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Create a new version instead of changing an existing definition';
END $$;
CREATE TRIGGER atlas_process_version_immutable BEFORE UPDATE ON atlas_process_versions
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_version_change();
CREATE TRIGGER atlas_profile_version_immutable BEFORE UPDATE ON atlas_profile_workflows
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_version_change();
ALTER TABLE atlas_profile_workflows ADD CONSTRAINT atlas_profile_workflow_identity UNIQUE(scope_id,profile,variant,version,workflow_scope,workflow_id,workflow_version);
ALTER TABLE atlas_runs ADD CONSTRAINT atlas_run_profile_workflow FOREIGN KEY(world_id,profile,variant,profile_version,workflow_scope,workflow_id,workflow_version)
    REFERENCES atlas_profile_workflows(scope_id,profile,variant,version,workflow_scope,workflow_id,workflow_version);
CREATE FUNCTION atlas_require_sealed_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS(SELECT FROM atlas_workflow_versions WHERE scope_id=NEW.workflow_scope AND id=NEW.workflow_id AND version=NEW.workflow_version AND sealed) OR
       NOT EXISTS(SELECT FROM atlas_value_sets WHERE id=NEW.parameters AND sealed) THEN
        RAISE EXCEPTION 'Runs require sealed definitions and parameters';
    END IF;
    IF NEW.checkpoint_id IS NOT NULL AND NOT EXISTS(SELECT FROM atlas_run_checkpoints
        WHERE id=NEW.checkpoint_id AND run_id=NEW.id AND plan_hash=NEW.plan_hash AND sealed) THEN
        RAISE EXCEPTION 'Run checkpoint must be sealed and match its pinned plan';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER atlas_run_sealed BEFORE INSERT OR UPDATE ON atlas_runs
    FOR EACH ROW EXECUTE FUNCTION atlas_require_sealed_run();
