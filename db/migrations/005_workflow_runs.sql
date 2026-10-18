CREATE TABLE atlas_runs (
    id uuid PRIMARY KEY, world_id uuid NOT NULL REFERENCES atlas_worlds(id), operation_id uuid NOT NULL,
    actor text NOT NULL, request_hash text NOT NULL, input_version bigint NOT NULL,
    area_id uuid NOT NULL, space_id uuid NOT NULL, footprint geometry NOT NULL,
    crs_id text NOT NULL, time_context text NOT NULL, resolution double precision,
    workflow_scope uuid NOT NULL, workflow_id text NOT NULL, workflow_version bigint NOT NULL,
    profile text NOT NULL, variant text NOT NULL, profile_version bigint NOT NULL,
    parameters uuid NOT NULL, seed text NOT NULL, seed_scope text NOT NULL, plan_hash text NOT NULL,
    status text NOT NULL CHECK(status IN ('queued','running','paused','cancelling','cancelled','failed','conflicted','completed')),
    stage text NOT NULL, progress double precision NOT NULL DEFAULT 0 CHECK(progress>=0 AND progress<=1),
    cancel_requested boolean NOT NULL DEFAULT false, lease_owner uuid, lease_expires timestamptz,
    attempt integer NOT NULL DEFAULT 1 CHECK(attempt>0), error_code text, error_message text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(world_id,operation_id), UNIQUE(world_id,id),
    FOREIGN KEY(world_id,input_version) REFERENCES atlas_world_versions(world_id,version),
    FOREIGN KEY(world_id,area_id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(workflow_scope,workflow_id,workflow_version) REFERENCES atlas_workflow_versions(scope_id,id,version),
    FOREIGN KEY(world_id,profile,variant,profile_version) REFERENCES atlas_profile_workflows(scope_id,profile,variant,version),
    FOREIGN KEY(world_id,parameters) REFERENCES atlas_value_sets(scope_id,id),
    CHECK(ST_SRID(footprint)=0 AND ST_IsValid(footprint) AND NOT ST_IsEmpty(footprint)),
    CHECK((lease_owner IS NULL)=(lease_expires IS NULL)),
    CHECK(resolution IS NULL OR (resolution>0 AND resolution<'Infinity'::float8))
);
CREATE INDEX atlas_runs_queue ON atlas_runs(status,created_at);
CREATE INDEX atlas_runs_world ON atlas_runs(world_id,created_at DESC);
CREATE TABLE atlas_run_plan_nodes (
    run_id uuid NOT NULL REFERENCES atlas_runs(id), path text[] NOT NULL, ordinal integer NOT NULL,
    workflow_scope uuid NOT NULL, workflow_id text NOT NULL, workflow_version bigint NOT NULL, invocation text NOT NULL,
    parameters uuid, halo_metres double precision NOT NULL CHECK(halo_metres>=0),
    PRIMARY KEY(run_id,path), UNIQUE(run_id,ordinal),
    FOREIGN KEY(workflow_scope,workflow_id,workflow_version,invocation) REFERENCES atlas_workflow_nodes(scope_id,workflow_id,workflow_version,id),
    FOREIGN KEY(parameters) REFERENCES atlas_value_sets(id)
);
CREATE TABLE atlas_run_write_scopes (
    run_id uuid NOT NULL REFERENCES atlas_runs(id), ordinal integer NOT NULL, space_id uuid NOT NULL,
    layer_id text NOT NULL, footprint geometry NOT NULL, time_context text NOT NULL, resolution double precision,
    PRIMARY KEY(run_id,ordinal), CHECK(ST_SRID(footprint)=0 AND ST_IsValid(footprint) AND NOT ST_IsEmpty(footprint))
);
CREATE INDEX atlas_run_write_extent ON atlas_run_write_scopes USING gist(run_id,space_id,footprint);
CREATE TABLE atlas_run_input_revisions (
    run_id uuid NOT NULL REFERENCES atlas_runs(id), scope_id uuid NOT NULL, object_id uuid NOT NULL,
    kind text NOT NULL, revision_id uuid NOT NULL REFERENCES atlas_revision_owners(id), version bigint NOT NULL,
    PRIMARY KEY(run_id,kind,object_id), FOREIGN KEY(scope_id,object_id) REFERENCES atlas_objects(scope_id,id)
);
CREATE TABLE atlas_resources (
    id uuid PRIMARY KEY, world_id uuid NOT NULL REFERENCES atlas_worlds(id), run_id uuid,
    kind text NOT NULL CHECK(kind IN ('field','vector','network','entities','history','value')),
    revision text NOT NULL, area_id uuid NOT NULL, space_id uuid NOT NULL, footprint geometry NOT NULL,
    crs_id text NOT NULL, time_context text NOT NULL, resolution double precision, unit text NOT NULL,
    grid_id uuid REFERENCES atlas_grids(id), values_id uuid,
    status text NOT NULL CHECK(status IN ('staged','validated','published')),
    content_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(world_id,id), FOREIGN KEY(world_id,run_id) REFERENCES atlas_runs(world_id,id),
    FOREIGN KEY(world_id,area_id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(world_id,values_id) REFERENCES atlas_value_sets(scope_id,id),
    CHECK(ST_SRID(footprint)=0 AND ST_IsValid(footprint) AND NOT ST_IsEmpty(footprint)),
    CHECK((kind='field')=(grid_id IS NOT NULL)),
    CHECK(kind<>'value' OR values_id IS NOT NULL)
);
CREATE INDEX atlas_resources_extent ON atlas_resources USING gist(world_id,space_id,footprint);
CREATE INDEX atlas_resources_run ON atlas_resources(run_id,status);
CREATE TABLE atlas_resource_facts (
    resource_id uuid NOT NULL REFERENCES atlas_resources(id), fact text NOT NULL,
    PRIMARY KEY(resource_id,fact)
);
CREATE INDEX atlas_resource_facts_name ON atlas_resource_facts(fact,resource_id);
CREATE TABLE atlas_resource_lineage (
    resource_id uuid NOT NULL REFERENCES atlas_resources(id), input_id uuid NOT NULL REFERENCES atlas_resources(id),
    mechanism text NOT NULL, ordinal integer NOT NULL,
    PRIMARY KEY(resource_id,input_id,mechanism), UNIQUE(resource_id,ordinal), CHECK(resource_id<>input_id)
);
CREATE TABLE atlas_resource_features (
    resource_id uuid NOT NULL REFERENCES atlas_resources(id), id uuid NOT NULL, ordinal integer NOT NULL,
    area_id uuid NOT NULL, layer_id text NOT NULL, name text NOT NULL, kind text NOT NULL, geometry geometry NOT NULL,
    state text NOT NULL, protected boolean NOT NULL, actor text NOT NULL, attributes uuid REFERENCES atlas_value_sets(id),
    causes text[] NOT NULL, PRIMARY KEY(resource_id,id), UNIQUE(resource_id,ordinal),
    CHECK(ST_SRID(geometry)=0 AND ST_IsValid(geometry) AND NOT ST_IsEmpty(geometry))
);
CREATE TABLE atlas_resource_entities (
    resource_id uuid NOT NULL REFERENCES atlas_resources(id), id uuid NOT NULL, ordinal integer NOT NULL,
    name text NOT NULL, kind text NOT NULL, state text NOT NULL, attributes uuid REFERENCES atlas_value_sets(id),
    PRIMARY KEY(resource_id,id), UNIQUE(resource_id,ordinal)
);
CREATE TABLE atlas_resource_relations (
    resource_id uuid NOT NULL REFERENCES atlas_resources(id), subject_id uuid NOT NULL,
    ordinal integer NOT NULL, target_id uuid NOT NULL, kind text NOT NULL,
    PRIMARY KEY(resource_id,subject_id,ordinal)
);
CREATE TABLE atlas_resource_connections (
    resource_id uuid NOT NULL REFERENCES atlas_resources(id), id uuid NOT NULL, ordinal integer NOT NULL, kind text NOT NULL,
    a_area uuid NOT NULL, a_x double precision NOT NULL, a_y double precision NOT NULL, a_z double precision NOT NULL, a_feature uuid,
    b_area uuid NOT NULL, b_x double precision NOT NULL, b_y double precision NOT NULL, b_z double precision NOT NULL, b_feature uuid,
    flow double precision NOT NULL, PRIMARY KEY(resource_id,id), UNIQUE(resource_id,ordinal)
);
CREATE TABLE atlas_run_checkpoints (
    id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES atlas_runs(id), sequence bigint NOT NULL CHECK(sequence>=0),
    plan_hash text NOT NULL, complete boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,sequence), UNIQUE(run_id,id)
);
CREATE TABLE atlas_checkpoint_nodes (
    checkpoint_id uuid NOT NULL REFERENCES atlas_run_checkpoints(id), path text[] NOT NULL,
    invocation text NOT NULL, iteration_path text[] NOT NULL,
    status text NOT NULL CHECK(status IN ('pending','running','completed','skipped')),
    continuation_version integer NOT NULL CHECK(continuation_version>0), state_values uuid REFERENCES atlas_value_sets(id),
    child_checkpoint uuid REFERENCES atlas_run_checkpoints(id), PRIMARY KEY(checkpoint_id,path),
    CHECK(status<>'running' OR state_values IS NOT NULL)
);
CREATE TABLE atlas_checkpoint_random (
    checkpoint_id uuid NOT NULL, node_path text[] NOT NULL, name text NOT NULL,
    counter bigint NOT NULL CHECK(counter>=0 AND counter<=9007199254740991),
    PRIMARY KEY(checkpoint_id,node_path,name),
    FOREIGN KEY(checkpoint_id,node_path) REFERENCES atlas_checkpoint_nodes(checkpoint_id,path)
);
CREATE TABLE atlas_checkpoint_iterations (
    checkpoint_id uuid NOT NULL REFERENCES atlas_run_checkpoints(id), ordinal integer NOT NULL,
    invocation text NOT NULL, index bigint NOT NULL CHECK(index>=0), epoch_id text, duration double precision,
    parent_epoch text, variables uuid NOT NULL REFERENCES atlas_value_sets(id),
    PRIMARY KEY(checkpoint_id,ordinal)
);
CREATE TABLE atlas_checkpoint_resources (
    checkpoint_id uuid NOT NULL REFERENCES atlas_run_checkpoints(id), node_path text[] NOT NULL,
    role text NOT NULL CHECK(role IN ('artifact','output','feedback','working')), port text NOT NULL,
    resource_id uuid NOT NULL REFERENCES atlas_resources(id),
    PRIMARY KEY(checkpoint_id,node_path,role,port)
);
CREATE TABLE atlas_checkpoint_causes (
    checkpoint_id uuid NOT NULL REFERENCES atlas_run_checkpoints(id), node_path text[] NOT NULL,
    ordinal integer NOT NULL, subject text NOT NULL, mechanism text NOT NULL, inputs text[] NOT NULL,
    PRIMARY KEY(checkpoint_id,node_path,ordinal)
);
CREATE TABLE atlas_checkpoint_invalidations (
    checkpoint_id uuid NOT NULL REFERENCES atlas_run_checkpoints(id), node_path text[] NOT NULL, fact text NOT NULL,
    PRIMARY KEY(checkpoint_id,node_path,fact)
);
CREATE TABLE atlas_run_diagnostics (
    run_id uuid NOT NULL REFERENCES atlas_runs(id), sequence bigint NOT NULL,
    invocation text, resource_id uuid REFERENCES atlas_resources(id), code text NOT NULL,
    severity text NOT NULL CHECK(severity IN ('error','warning')), message text NOT NULL,
    PRIMARY KEY(run_id,sequence)
);
ALTER TABLE atlas_runs ADD COLUMN checkpoint_id uuid;
ALTER TABLE atlas_runs ADD FOREIGN KEY(id,checkpoint_id) REFERENCES atlas_run_checkpoints(run_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE atlas_run_inputs (
    run_id uuid NOT NULL REFERENCES atlas_runs(id), port text NOT NULL, resource_id uuid NOT NULL REFERENCES atlas_resources(id),
    PRIMARY KEY(run_id,port)
);
CREATE TABLE atlas_operation_changes (
    world_id uuid NOT NULL, operation_id uuid NOT NULL, ordinal integer NOT NULL, kind text NOT NULL, object_id text NOT NULL,
    before_revision uuid REFERENCES atlas_revision_owners(id), after_revision uuid REFERENCES atlas_revision_owners(id),
    PRIMARY KEY(world_id,operation_id,ordinal), FOREIGN KEY(world_id,operation_id) REFERENCES atlas_operations(world_id,operation_id)
);
CREATE TABLE atlas_invalidations (
    id uuid PRIMARY KEY, world_id uuid NOT NULL REFERENCES atlas_worlds(id), version bigint NOT NULL,
    space_id uuid NOT NULL, fact text NOT NULL, footprint geometry NOT NULL, cause text NOT NULL,
    resolved_at_version bigint, FOREIGN KEY(world_id,version) REFERENCES atlas_world_versions(world_id,version),
    CHECK(ST_SRID(footprint)=0 AND ST_IsValid(footprint) AND NOT ST_IsEmpty(footprint))
);
CREATE INDEX atlas_invalidations_extent ON atlas_invalidations USING gist(world_id,space_id,footprint) WHERE resolved_at_version IS NULL;
CREATE TABLE atlas_template_instance_members (
    world_id uuid NOT NULL, instance_id uuid NOT NULL, definition_scope uuid NOT NULL REFERENCES atlas_template_definitions(scope_id),
    definition_id uuid NOT NULL, object_id uuid NOT NULL, kind text NOT NULL,
    PRIMARY KEY(world_id,instance_id,kind,definition_id),
    FOREIGN KEY(world_id,instance_id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(world_id,object_id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(definition_scope,definition_id) REFERENCES atlas_objects(scope_id,id)
);
