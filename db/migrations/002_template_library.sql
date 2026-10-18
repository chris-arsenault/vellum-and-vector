CREATE TYPE atlas_template_requirements AS (context_kinds text[], fields atlas_trait[], maximum_slope double precision, street_access boolean);
CREATE TABLE atlas_template_definitions (
    scope_id uuid PRIMARY KEY REFERENCES atlas_scopes(id), id uuid NOT NULL, version bigint NOT NULL CHECK(version>0),
    name text NOT NULL, profile integer NOT NULL, parent_profiles integer[] NOT NULL, footprint geometry NOT NULL,
    traits atlas_trait[] NOT NULL, frame atlas_frame NOT NULL, units text NOT NULL, requirements atlas_template_requirements,
    recipe atlas_recipe, context text NOT NULL, has_entities boolean NOT NULL, has_layers boolean NOT NULL,
    has_sockets boolean NOT NULL, has_spaces boolean NOT NULL
);
CREATE TABLE atlas_template_spaces (
    scope_id uuid NOT NULL REFERENCES atlas_template_definitions(scope_id), ordinal integer NOT NULL, id uuid NOT NULL,
    name text NOT NULL, footprint geometry NOT NULL, frame atlas_frame NOT NULL, PRIMARY KEY(scope_id,ordinal), UNIQUE(scope_id,id)
);
CREATE TABLE atlas_template_sockets (
    scope_id uuid NOT NULL REFERENCES atlas_template_definitions(scope_id), ordinal integer NOT NULL, id text NOT NULL,
    feature_id uuid NOT NULL, point atlas_position NOT NULL, kind text NOT NULL, required boolean NOT NULL, target_kinds text[], space_id uuid, connects_to text,
    PRIMARY KEY(scope_id,ordinal), FOREIGN KEY(scope_id,feature_id) REFERENCES atlas_objects(scope_id,id)
);
CREATE TABLE atlas_template_members (
    scope_id uuid NOT NULL REFERENCES atlas_template_definitions(scope_id), kind text NOT NULL, ordinal integer NOT NULL, id text NOT NULL,
    PRIMARY KEY(scope_id,kind,ordinal), UNIQUE(scope_id,kind,id)
);
CREATE TABLE atlas_templates (
    owner text NOT NULL, id uuid NOT NULL, version bigint NOT NULL, definition_scope uuid NOT NULL REFERENCES atlas_template_definitions(scope_id),
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner,id)
);
CREATE TABLE atlas_world_templates (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL REFERENCES atlas_scopes(id), id uuid NOT NULL,
    valid_from bigint NOT NULL, valid_to bigint, definition_scope uuid NOT NULL REFERENCES atlas_template_definitions(scope_id)
);
CREATE UNIQUE INDEX atlas_world_templates_current ON atlas_world_templates(scope_id,id) WHERE valid_to IS NULL;
ALTER TABLE atlas_world_templates ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
CREATE TABLE atlas_template_context_refs (
    scope_id uuid NOT NULL REFERENCES atlas_template_definitions(scope_id), target_id uuid NOT NULL, world_scope uuid NOT NULL,
    PRIMARY KEY(scope_id,target_id), FOREIGN KEY(world_scope,target_id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(scope_id,target_id) REFERENCES atlas_objects(scope_id,id)
);
