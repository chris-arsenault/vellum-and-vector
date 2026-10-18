-- Extensible values have declared schemas; core workflow/domain structure is relational.
CREATE TABLE atlas_value_sets (
    id uuid PRIMARY KEY, scope_id uuid NOT NULL REFERENCES atlas_scopes(id),
    purpose text NOT NULL CHECK(purpose IN ('parameters','defaults','choices','epoch','continuation','binding','value')),
    schema_id text NOT NULL, schema_version integer NOT NULL CHECK(schema_version>0),
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(scope_id,id)
);
CREATE TABLE atlas_values (
    value_set uuid NOT NULL REFERENCES atlas_value_sets(id), path text[] NOT NULL,
    ordinal integer NOT NULL CHECK(ordinal>=0),
    kind text NOT NULL CHECK(kind IN ('null','text','number','boolean','record','list')),
    text_value text, number_value double precision, boolean_value boolean,
    PRIMARY KEY(value_set,path), UNIQUE(value_set,ordinal),
    CHECK((kind='text' AND text_value IS NOT NULL AND number_value IS NULL AND boolean_value IS NULL) OR
          (kind='number' AND number_value IS NOT NULL AND text_value IS NULL AND boolean_value IS NULL
           AND number_value>'-Infinity'::float8 AND number_value<'Infinity'::float8) OR
          (kind='boolean' AND boolean_value IS NOT NULL AND text_value IS NULL AND number_value IS NULL) OR
          (kind IN ('null','record','list') AND text_value IS NULL AND number_value IS NULL AND boolean_value IS NULL))
);
CREATE TABLE atlas_process_versions (
    id text NOT NULL, version text NOT NULL, continuation_version integer NOT NULL CHECK(continuation_version>0),
    implementation_hash text NOT NULL, PRIMARY KEY(id,version)
);
CREATE TABLE atlas_workflow_versions (
    scope_id uuid NOT NULL REFERENCES atlas_scopes(id), id text NOT NULL, version bigint NOT NULL CHECK(version>0),
    name text NOT NULL, iteration_kind text CHECK(iteration_kind IN ('epochs','condition')),
    definition_hash text NOT NULL, sealed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope_id,id,version)
);
CREATE TABLE atlas_workflow_nodes (
    scope_id uuid NOT NULL, workflow_id text NOT NULL, workflow_version bigint NOT NULL,
    id text NOT NULL, ordinal integer NOT NULL CHECK(ordinal>=0), process_id text NOT NULL, process_version text NOT NULL,
    body_scope uuid, body_workflow text, body_version bigint,
    PRIMARY KEY(scope_id,workflow_id,workflow_version,id), UNIQUE(scope_id,workflow_id,workflow_version,ordinal),
    FOREIGN KEY(scope_id,workflow_id,workflow_version) REFERENCES atlas_workflow_versions(scope_id,id,version),
    FOREIGN KEY(process_id,process_version) REFERENCES atlas_process_versions(id,version),
    FOREIGN KEY(body_scope,body_workflow,body_version) REFERENCES atlas_workflow_versions(scope_id,id,version),
    CHECK((body_scope IS NULL AND body_workflow IS NULL AND body_version IS NULL) OR
          (body_scope IS NOT NULL AND body_workflow IS NOT NULL AND body_version IS NOT NULL))
);
CREATE TABLE atlas_workflow_order_edges (
    scope_id uuid NOT NULL, workflow_id text NOT NULL, workflow_version bigint NOT NULL,
    predecessor text NOT NULL, successor text NOT NULL, PRIMARY KEY(scope_id,workflow_id,workflow_version,predecessor,successor),
    FOREIGN KEY(scope_id,workflow_id,workflow_version,predecessor) REFERENCES atlas_workflow_nodes(scope_id,workflow_id,workflow_version,id),
    FOREIGN KEY(scope_id,workflow_id,workflow_version,successor) REFERENCES atlas_workflow_nodes(scope_id,workflow_id,workflow_version,id),
    CHECK(predecessor<>successor)
);
CREATE TABLE atlas_workflow_ports (
    scope_id uuid NOT NULL, workflow_id text NOT NULL, workflow_version bigint NOT NULL,
    owner_node text NOT NULL, node_id text, direction text NOT NULL CHECK(direction IN ('input','output')), name text NOT NULL,
    resource_kind text NOT NULL CHECK(resource_kind IN ('field','vector','network','entities','history','value')),
    unit text NOT NULL, optional boolean NOT NULL, facts text[] NOT NULL,
    PRIMARY KEY(scope_id,workflow_id,workflow_version,owner_node,direction,name),
    FOREIGN KEY(scope_id,workflow_id,workflow_version) REFERENCES atlas_workflow_versions(scope_id,id,version),
    FOREIGN KEY(scope_id,workflow_id,workflow_version,node_id) REFERENCES atlas_workflow_nodes(scope_id,workflow_id,workflow_version,id),
    CHECK(owner_node=COALESCE(node_id,''))
);
CREATE TABLE atlas_parameter_definitions (
    id uuid PRIMARY KEY, scope_id uuid NOT NULL, workflow_id text NOT NULL, workflow_version bigint NOT NULL,
    namespace text NOT NULL CHECK(namespace IN ('parameter','variable','node')),
    owner_node text NOT NULL, node_id text, path text[] NOT NULL, ordinal integer NOT NULL CHECK(ordinal>=0), parent_id uuid,
    value_type text NOT NULL CHECK(value_type IN ('number','integer','boolean','text','enum','resource','record','list')),
    unit text, required boolean NOT NULL, minimum double precision, maximum double precision,
    override_mode text NOT NULL CHECK(override_mode IN ('replace','merge')),
    default_values uuid, choices uuid,
    UNIQUE(scope_id,workflow_id,workflow_version,namespace,owner_node,path),
    UNIQUE(scope_id,workflow_id,workflow_version,namespace,owner_node,id),
    FOREIGN KEY(scope_id,workflow_id,workflow_version,namespace,owner_node,parent_id)
        REFERENCES atlas_parameter_definitions(scope_id,workflow_id,workflow_version,namespace,owner_node,id),
    FOREIGN KEY(scope_id,workflow_id,workflow_version) REFERENCES atlas_workflow_versions(scope_id,id,version),
    FOREIGN KEY(scope_id,workflow_id,workflow_version,node_id) REFERENCES atlas_workflow_nodes(scope_id,workflow_id,workflow_version,id),
    FOREIGN KEY(scope_id,default_values) REFERENCES atlas_value_sets(scope_id,id),
    FOREIGN KEY(scope_id,choices) REFERENCES atlas_value_sets(scope_id,id),
    CHECK(owner_node=COALESCE(node_id,'')), CHECK(minimum IS NULL OR maximum IS NULL OR minimum<=maximum)
);
CREATE TABLE atlas_workflow_bindings (
    id uuid PRIMARY KEY, scope_id uuid NOT NULL, workflow_id text NOT NULL, workflow_version bigint NOT NULL,
    target_kind text NOT NULL CHECK(target_kind IN ('input','parameter','output','condition','feedback_initial','feedback_next','until')),
    owner_node text NOT NULL, target_node text, target_port text NOT NULL,
    source_kind text NOT NULL CHECK(source_kind IN ('literal','parameter','epoch','input','output','feedback','domain')),
    source_node text, source_key text, literal_values uuid, comparison_values uuid,
    UNIQUE(scope_id,workflow_id,workflow_version,target_kind,owner_node,target_port),
    UNIQUE(scope_id,workflow_id,workflow_version,id),
    FOREIGN KEY(scope_id,workflow_id,workflow_version) REFERENCES atlas_workflow_versions(scope_id,id,version),
    FOREIGN KEY(scope_id,workflow_id,workflow_version,target_node) REFERENCES atlas_workflow_nodes(scope_id,workflow_id,workflow_version,id),
    FOREIGN KEY(scope_id,workflow_id,workflow_version,source_node) REFERENCES atlas_workflow_nodes(scope_id,workflow_id,workflow_version,id),
    FOREIGN KEY(scope_id,literal_values) REFERENCES atlas_value_sets(scope_id,id),
    FOREIGN KEY(scope_id,comparison_values) REFERENCES atlas_value_sets(scope_id,id),
    CHECK(owner_node=COALESCE(target_node,'')),
    CHECK((source_kind='literal' AND literal_values IS NOT NULL AND source_node IS NULL AND source_key IS NULL) OR
          (source_kind='output' AND source_node IS NOT NULL AND source_key IS NOT NULL AND literal_values IS NULL) OR
          (source_kind NOT IN ('literal','output') AND source_node IS NULL AND source_key IS NOT NULL AND literal_values IS NULL))
);
CREATE TABLE atlas_workflow_feedback (
    scope_id uuid NOT NULL, workflow_id text NOT NULL, workflow_version bigint NOT NULL, port text NOT NULL,
    mode text NOT NULL CHECK(mode IN ('carry','reset','accumulate')),
    initial_binding uuid NOT NULL, next_binding uuid NOT NULL,
    PRIMARY KEY(scope_id,workflow_id,workflow_version,port),
    FOREIGN KEY(scope_id,workflow_id,workflow_version) REFERENCES atlas_workflow_versions(scope_id,id,version),
    FOREIGN KEY(scope_id,workflow_id,workflow_version,initial_binding) REFERENCES atlas_workflow_bindings(scope_id,workflow_id,workflow_version,id),
    FOREIGN KEY(scope_id,workflow_id,workflow_version,next_binding) REFERENCES atlas_workflow_bindings(scope_id,workflow_id,workflow_version,id)
);
CREATE TABLE atlas_workflow_epochs (
    scope_id uuid NOT NULL, workflow_id text NOT NULL, workflow_version bigint NOT NULL,
    id text NOT NULL, ordinal integer NOT NULL CHECK(ordinal>=0), duration double precision NOT NULL CHECK(duration>=0 AND duration<'Infinity'::float8),
    parent_epoch text, variables uuid NOT NULL,
    PRIMARY KEY(scope_id,workflow_id,workflow_version,id), UNIQUE(scope_id,workflow_id,workflow_version,ordinal),
    FOREIGN KEY(scope_id,workflow_id,workflow_version) REFERENCES atlas_workflow_versions(scope_id,id,version),
    FOREIGN KEY(scope_id,variables) REFERENCES atlas_value_sets(scope_id,id)
);
CREATE TABLE atlas_workflow_defaults (
    scope_id uuid NOT NULL, workflow_id text NOT NULL, workflow_version bigint NOT NULL, variables uuid NOT NULL,
    PRIMARY KEY(scope_id,workflow_id,workflow_version),
    FOREIGN KEY(scope_id,workflow_id,workflow_version) REFERENCES atlas_workflow_versions(scope_id,id,version),
    FOREIGN KEY(scope_id,variables) REFERENCES atlas_value_sets(scope_id,id)
);
CREATE TABLE atlas_profile_workflows (
    scope_id uuid NOT NULL REFERENCES atlas_scopes(id), profile text NOT NULL CHECK(profile IN ('world','region','local','site','interior')),
    variant text NOT NULL, version bigint NOT NULL CHECK(version>0), workflow_scope uuid NOT NULL, workflow_id text NOT NULL,
    workflow_version bigint NOT NULL, defaults uuid NOT NULL,
    PRIMARY KEY(scope_id,profile,variant,version),
    FOREIGN KEY(workflow_scope,workflow_id,workflow_version) REFERENCES atlas_workflow_versions(scope_id,id,version),
    FOREIGN KEY(scope_id,defaults) REFERENCES atlas_value_sets(scope_id,id)
);
CREATE TABLE atlas_area_workflows (
    revision_id uuid PRIMARY KEY REFERENCES atlas_revision_owners(id), scope_id uuid NOT NULL, area_id uuid NOT NULL,
    valid_from bigint NOT NULL, valid_to bigint, profile text NOT NULL, variant text NOT NULL, profile_version bigint NOT NULL,
    parameters uuid NOT NULL,
    FOREIGN KEY(scope_id,area_id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(scope_id,profile,variant,profile_version) REFERENCES atlas_profile_workflows(scope_id,profile,variant,version),
    FOREIGN KEY(scope_id,parameters) REFERENCES atlas_value_sets(scope_id,id), CHECK(valid_to IS NULL OR valid_to>valid_from)
);
CREATE UNIQUE INDEX atlas_area_workflows_current ON atlas_area_workflows(scope_id,area_id) WHERE valid_to IS NULL;
CREATE TABLE atlas_template_workflows (
    definition_scope uuid PRIMARY KEY REFERENCES atlas_template_definitions(scope_id), workflow_scope uuid NOT NULL,
    workflow_id text NOT NULL, workflow_version bigint NOT NULL, parameters uuid NOT NULL,
    FOREIGN KEY(workflow_scope,workflow_id,workflow_version) REFERENCES atlas_workflow_versions(scope_id,id,version),
    FOREIGN KEY(definition_scope,parameters) REFERENCES atlas_value_sets(scope_id,id)
);

CREATE FUNCTION atlas_guard_sealed_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_scope uuid; row_id text; row_version bigint;
BEGIN
    IF TG_TABLE_NAME='atlas_workflow_versions' THEN
        IF TG_OP='DELETE' OR OLD.sealed THEN RAISE EXCEPTION 'Workflow versions are immutable after sealing'; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP='UPDATE' AND EXISTS(SELECT FROM atlas_workflow_versions
        WHERE scope_id=OLD.scope_id AND id=OLD.workflow_id AND version=OLD.workflow_version AND sealed) THEN
        RAISE EXCEPTION 'Workflow definitions are immutable after sealing';
    END IF;
    IF TG_OP='DELETE' THEN
        row_scope:=OLD.scope_id; row_id:=OLD.workflow_id; row_version:=OLD.workflow_version;
    ELSE
        row_scope:=NEW.scope_id; row_id:=NEW.workflow_id; row_version:=NEW.workflow_version;
    END IF;
    IF EXISTS(SELECT FROM atlas_workflow_versions WHERE scope_id=row_scope AND id=row_id AND version=row_version AND sealed) THEN
        RAISE EXCEPTION 'Workflow definitions are immutable after sealing';
    END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER atlas_workflow_version_immutable BEFORE UPDATE OR DELETE ON atlas_workflow_versions
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_workflow();
DO $$ DECLARE table_name text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['atlas_workflow_nodes','atlas_workflow_order_edges','atlas_workflow_ports',
        'atlas_parameter_definitions','atlas_workflow_bindings','atlas_workflow_feedback','atlas_workflow_epochs','atlas_workflow_defaults'] LOOP
        EXECUTE format('CREATE TRIGGER workflow_sealed BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_workflow()',table_name);
    END LOOP;
END $$;
