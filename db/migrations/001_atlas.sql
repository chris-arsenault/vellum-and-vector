-- The platform first provisions the database. An administrator then enables
-- postgis and btree_gist manually; application migrations never install them.
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_extension WHERE extname='postgis') OR
       NOT EXISTS (SELECT FROM pg_extension WHERE extname='btree_gist') THEN
        RAISE EXCEPTION 'Manual database setup required: enable postgis and btree_gist in this database as described in README.md, then rerun migrations.';
    END IF;
END $$;

CREATE TYPE atlas_position AS (x double precision, y double precision, z double precision);
CREATE TYPE atlas_frame AS (origin atlas_position, rotation double precision, metres_per_unit double precision, floor text);
CREATE TYPE atlas_epoch AS (id text, tectonics integer, hydrology integer, ice integer, coasts integer, temperature integer, sea_level integer);
CREATE TYPE atlas_human_era AS (id text, years integer, physical_epoch text, mobility double precision, political_capacity double precision);
CREATE TYPE atlas_trait AS (field text, kind integer, minimum double precision, maximum double precision, cause text, scope geometry);
CREATE TYPE atlas_crossing AS (feature_id uuid, point atlas_position, kind text, flow double precision, elevation double precision,
    direction text, node_id uuid, receiving_feature_id uuid, flow_uncertainty double precision, flow_minimum double precision, flow_maximum double precision);
CREATE TYPE atlas_sample AS (point atlas_position, channels text[], values double precision[]);
CREATE TYPE atlas_ring AS (samples atlas_sample[]);
CREATE TYPE atlas_water_flux AS (id uuid, point atlas_position, direction atlas_position, rate double precision, crossing text);
CREATE TYPE atlas_boundary AS (version integer, parent_id uuid, parent_version bigint, crossings atlas_crossing[],
    samples atlas_sample[], epochs atlas_epoch[], rings atlas_ring[], water_fluxes atlas_water_flux[]);
CREATE TYPE atlas_recipe AS (domains text[], seed integer, quality text);
CREATE TYPE atlas_impact AS (features uuid[], areas uuid[], layers text[], invalidations text[], high_impact boolean);

-- Every immutable template definition has a separate scope from live worlds.
CREATE TABLE atlas_scopes (id uuid PRIMARY KEY, owner text NOT NULL, kind text NOT NULL CHECK(kind IN ('world','template')));
CREATE TABLE atlas_objects (
    scope_id uuid NOT NULL REFERENCES atlas_scopes(id), id uuid NOT NULL, kind text NOT NULL,
    PRIMARY KEY(scope_id,id)
);
CREATE TABLE atlas_revision_owners (id uuid PRIMARY KEY, scope_id uuid NOT NULL REFERENCES atlas_scopes(id));
CREATE TABLE atlas_worlds (
    id uuid PRIMARY KEY REFERENCES atlas_scopes(id), owner text NOT NULL, name text NOT NULL,
    version bigint NOT NULL CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX atlas_worlds_owner ON atlas_worlds(owner);
CREATE TABLE atlas_world_versions (
    world_id uuid NOT NULL REFERENCES atlas_worlds(id), version bigint NOT NULL, name text NOT NULL, seed integer NOT NULL,
    crs_id text NOT NULL, domain geometry NOT NULL, topology text NOT NULL, units text NOT NULL, axes text NOT NULL,
    vertical_datum text NOT NULL, crs_version integer NOT NULL, precision double precision NOT NULL CHECK(precision>0),
    epochs atlas_epoch[] NOT NULL, human_eras atlas_human_era[] NOT NULL,
    PRIMARY KEY(world_id,version), CHECK(ST_SRID(domain)=0)
);
CREATE TABLE atlas_operations (
    world_id uuid NOT NULL REFERENCES atlas_worlds(id), operation_id uuid NOT NULL, version bigint NOT NULL,
    before_version bigint NOT NULL, actor text NOT NULL, kind text NOT NULL, request_hash text NOT NULL,
    impact atlas_impact NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(world_id,operation_id), UNIQUE(world_id,version),
    FOREIGN KEY(world_id,version) REFERENCES atlas_world_versions(world_id,version),
    FOREIGN KEY(world_id,before_version) REFERENCES atlas_world_versions(world_id,version)
);

CREATE TABLE atlas_areas (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL, id uuid NOT NULL, valid_from bigint NOT NULL, valid_to bigint,
    parent_id uuid, name text NOT NULL, profile integer NOT NULL CHECK(profile BETWEEN 0 AND 4), footprint geometry NOT NULL,
    frame atlas_frame NOT NULL, boundary atlas_boundary, traits atlas_trait[] NOT NULL, local_traits atlas_trait[],
    version bigint NOT NULL, template_id uuid, context text NOT NULL, context_feature_id uuid, template_instance_id uuid,
    recipe atlas_recipe, recipe_job_id uuid,
    FOREIGN KEY(scope_id,id) REFERENCES atlas_objects(scope_id,id), FOREIGN KEY(scope_id,parent_id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(scope_id,context_feature_id) REFERENCES atlas_objects(scope_id,id),
    CHECK(valid_to IS NULL OR valid_to>valid_from), CHECK(ST_SRID(footprint)=0)
);
CREATE UNIQUE INDEX atlas_areas_current ON atlas_areas(scope_id,id) WHERE valid_to IS NULL;
CREATE INDEX atlas_areas_history ON atlas_areas(scope_id,valid_from,valid_to);
CREATE TABLE atlas_area_layers (revision_id uuid NOT NULL REFERENCES atlas_areas(revision_id), layer_id text NOT NULL, state integer NOT NULL, PRIMARY KEY(revision_id,layer_id));
CREATE TABLE atlas_layers (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL REFERENCES atlas_scopes(id), id text NOT NULL,
    valid_from bigint NOT NULL, valid_to bigint, name text NOT NULL, family text NOT NULL, representation text NOT NULL,
    color text NOT NULL, profiles integer[] NOT NULL, generator text, CHECK(valid_to IS NULL OR valid_to>valid_from)
);
CREATE UNIQUE INDEX atlas_layers_current ON atlas_layers(scope_id,id) WHERE valid_to IS NULL;
CREATE INDEX atlas_layers_history ON atlas_layers(scope_id,valid_from,valid_to);
CREATE TABLE atlas_features (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL, id uuid NOT NULL, valid_from bigint NOT NULL, valid_to bigint,
    name text NOT NULL, kind text NOT NULL, layer_id text NOT NULL, area_id uuid NOT NULL, geometry geometry NOT NULL,
    state integer NOT NULL, protected boolean NOT NULL, actor text NOT NULL, generation_id uuid, generation_domain text, causes text[] NOT NULL,
    FOREIGN KEY(scope_id,id) REFERENCES atlas_objects(scope_id,id), FOREIGN KEY(scope_id,area_id) REFERENCES atlas_objects(scope_id,id),
    CHECK(valid_to IS NULL OR valid_to>valid_from), CHECK(ST_SRID(geometry)=0)
);
CREATE UNIQUE INDEX atlas_features_current ON atlas_features(scope_id,id) WHERE valid_to IS NULL;
CREATE INDEX atlas_features_history ON atlas_features(scope_id,valid_from,valid_to);
CREATE TABLE atlas_representations (
    revision_id uuid PRIMARY KEY, feature_revision uuid NOT NULL REFERENCES atlas_features(revision_id), area_id uuid NOT NULL,
    geometry geometry NOT NULL, state integer NOT NULL, actor text NOT NULL, generation_id uuid,
    protected boolean NOT NULL, needs_reconciliation boolean NOT NULL, has_attributes boolean NOT NULL,
    UNIQUE(feature_revision,area_id), CHECK(ST_SRID(geometry)=0)
);
CREATE TABLE atlas_entities (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL, id uuid NOT NULL, valid_from bigint NOT NULL, valid_to bigint,
    name text NOT NULL, kind text NOT NULL, state integer NOT NULL,
    FOREIGN KEY(scope_id,id) REFERENCES atlas_objects(scope_id,id), CHECK(valid_to IS NULL OR valid_to>valid_from)
);
CREATE UNIQUE INDEX atlas_entities_current ON atlas_entities(scope_id,id) WHERE valid_to IS NULL;
CREATE INDEX atlas_entities_history ON atlas_entities(scope_id,valid_from,valid_to);
CREATE TABLE atlas_relations (
    revision_id uuid NOT NULL, ordinal integer NOT NULL, scope_id uuid NOT NULL, target_id uuid NOT NULL, kind text NOT NULL,
    PRIMARY KEY(revision_id,ordinal), FOREIGN KEY(scope_id,target_id) REFERENCES atlas_objects(scope_id,id)
);

-- Paths apply only to extensible GIS attributes and layer schemas, never to
-- core objects. Domain profiles and histories have dedicated tables below.
CREATE TABLE atlas_attributes (
    revision_id uuid NOT NULL, path text[] NOT NULL, ordinal integer NOT NULL,
    kind text NOT NULL CHECK(kind IN ('object','array','null','text','number','boolean')),
    text_value text, number_value numeric, bool_value boolean,
    PRIMARY KEY(revision_id,path), UNIQUE(revision_id,ordinal),
    CHECK((kind='text' AND text_value IS NOT NULL AND number_value IS NULL AND bool_value IS NULL) OR
          (kind='number' AND number_value IS NOT NULL AND text_value IS NULL AND bool_value IS NULL) OR
          (kind='boolean' AND bool_value IS NOT NULL AND text_value IS NULL AND number_value IS NULL) OR
          (kind IN ('object','array','null') AND text_value IS NULL AND number_value IS NULL AND bool_value IS NULL))
);
CREATE INDEX atlas_attributes_numbers ON atlas_attributes(path,number_value) WHERE kind='number';
CREATE INDEX atlas_attributes_text ON atlas_attributes(path,text_value) WHERE kind='text';
-- Presence/null metadata for typed domain records, without duplicating values.
CREATE TABLE atlas_attribute_shapes (
    revision_id uuid NOT NULL REFERENCES atlas_revision_owners(id), attribute text NOT NULL, path integer[] NOT NULL,
    properties text[] NOT NULL, null_properties text[] NOT NULL, PRIMARY KEY(revision_id,attribute,path)
);
CREATE TABLE atlas_stations (
    revision_id uuid NOT NULL, channel text NOT NULL, part integer NOT NULL, station integer NOT NULL, value double precision NOT NULL,
    PRIMARY KEY(revision_id,channel,part,station)
);
CREATE TABLE atlas_construction_events (
    revision_id uuid NOT NULL, ordinal integer NOT NULL, era text, action text, cause text, depth double precision, PRIMARY KEY(revision_id,ordinal)
);
CREATE TABLE atlas_cave_stations (
    revision_id uuid NOT NULL REFERENCES atlas_revision_owners(id), station integer NOT NULL, PRIMARY KEY(revision_id,station)
);
CREATE TABLE atlas_cave_events (
    revision_id uuid NOT NULL, station integer NOT NULL, ordinal integer NOT NULL, epoch text NOT NULL,
    dissolution double precision NOT NULL, collapse double precision NOT NULL, deposition double precision NOT NULL, ice_damage double precision NOT NULL,
    PRIMARY KEY(revision_id,station,ordinal), FOREIGN KEY(revision_id,station) REFERENCES atlas_cave_stations(revision_id,station)
);
CREATE TABLE atlas_feature_positions (
    revision_id uuid NOT NULL, role text NOT NULL, ordinal integer NOT NULL, point atlas_position, PRIMARY KEY(revision_id,role,ordinal)
);
CREATE TABLE atlas_hypsometry (
    revision_id uuid NOT NULL, ordinal integer NOT NULL, floor double precision NOT NULL, area double precision NOT NULL,
    footprint geometry, sediment double precision NOT NULL, PRIMARY KEY(revision_id,ordinal)
);
CREATE TABLE atlas_water_exchange (revision_id uuid PRIMARY KEY, mechanism text NOT NULL, volume double precision NOT NULL, years double precision NOT NULL);

CREATE TABLE atlas_connections (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL, id uuid NOT NULL, valid_from bigint NOT NULL, valid_to bigint,
    kind text NOT NULL, a_area uuid NOT NULL, a_point atlas_position NOT NULL, a_feature uuid,
    b_area uuid NOT NULL, b_point atlas_position NOT NULL, b_feature uuid, flow double precision NOT NULL,
    FOREIGN KEY(scope_id,id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(scope_id,a_area) REFERENCES atlas_objects(scope_id,id), FOREIGN KEY(scope_id,b_area) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(scope_id,a_feature) REFERENCES atlas_objects(scope_id,id), FOREIGN KEY(scope_id,b_feature) REFERENCES atlas_objects(scope_id,id)
);
CREATE UNIQUE INDEX atlas_connections_current ON atlas_connections(scope_id,id) WHERE valid_to IS NULL;
CREATE TABLE atlas_nodes (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL, id uuid NOT NULL, valid_from bigint NOT NULL, valid_to bigint,
    kind text NOT NULL, point atlas_position NOT NULL, space_id uuid, water_level double precision,
    FOREIGN KEY(scope_id,id) REFERENCES atlas_objects(scope_id,id), FOREIGN KEY(scope_id,space_id) REFERENCES atlas_objects(scope_id,id)
);
CREATE UNIQUE INDEX atlas_nodes_current ON atlas_nodes(scope_id,id) WHERE valid_to IS NULL;
CREATE TABLE atlas_reaches (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL, id uuid NOT NULL, valid_from bigint NOT NULL, valid_to bigint,
    feature_id uuid NOT NULL, start_id uuid NOT NULL, end_id uuid NOT NULL, geometry geometry NOT NULL, flow double precision NOT NULL, end_flow double precision,
    FOREIGN KEY(scope_id,id) REFERENCES atlas_objects(scope_id,id), FOREIGN KEY(scope_id,feature_id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(scope_id,start_id) REFERENCES atlas_objects(scope_id,id), FOREIGN KEY(scope_id,end_id) REFERENCES atlas_objects(scope_id,id)
);
CREATE UNIQUE INDEX atlas_reaches_current ON atlas_reaches(scope_id,id) WHERE valid_to IS NULL;
CREATE TABLE atlas_magic (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL, id uuid NOT NULL, valid_from bigint NOT NULL, valid_to bigint,
    ordinal integer NOT NULL, name text NOT NULL, source atlas_position NOT NULL, radius double precision NOT NULL, strength double precision NOT NULL,
    propagation text NOT NULL, effect text NOT NULL, decay double precision NOT NULL, storage double precision NOT NULL,
    depends_on uuid[], scope geometry, starts_at_epoch integer NOT NULL, FOREIGN KEY(scope_id,id) REFERENCES atlas_objects(scope_id,id)
);
CREATE UNIQUE INDEX atlas_magic_current ON atlas_magic(scope_id,id) WHERE valid_to IS NULL;
CREATE TABLE atlas_views (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL, id uuid NOT NULL, valid_from bigint NOT NULL, valid_to bigint,
    ordinal integer NOT NULL, name text NOT NULL, area_id uuid NOT NULL, FOREIGN KEY(scope_id,id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(scope_id,area_id) REFERENCES atlas_objects(scope_id,id)
);
CREATE UNIQUE INDEX atlas_views_current ON atlas_views(scope_id,id) WHERE valid_to IS NULL;
CREATE TABLE atlas_view_layers (
    revision_id uuid NOT NULL REFERENCES atlas_views(revision_id), ordinal integer NOT NULL, layer_id text NOT NULL,
    visible boolean NOT NULL, opacity double precision NOT NULL, color text NOT NULL, min_scale double precision NOT NULL, labels boolean NOT NULL, filter text,
    PRIMARY KEY(revision_id,ordinal)
);
CREATE TABLE atlas_field_references (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL, id uuid NOT NULL, valid_from bigint NOT NULL, valid_to bigint,
    ordinal integer NOT NULL, area_id uuid NOT NULL, layer_id text NOT NULL, algorithm text NOT NULL, job_id uuid NOT NULL, samples integer NOT NULL, channels text[],
    FOREIGN KEY(scope_id,id) REFERENCES atlas_objects(scope_id,id), FOREIGN KEY(scope_id,area_id) REFERENCES atlas_objects(scope_id,id)
);
CREATE UNIQUE INDEX atlas_field_references_current ON atlas_field_references(scope_id,id) WHERE valid_to IS NULL;
CREATE TABLE atlas_generations (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL, id uuid NOT NULL, valid_from bigint NOT NULL, valid_to bigint,
    ordinal integer NOT NULL, area_id uuid NOT NULL, seed integer NOT NULL, algorithm text NOT NULL, quality text NOT NULL,
    domains text[] NOT NULL, boundary_version integer NOT NULL, epochs atlas_epoch[] NOT NULL, completed_at timestamptz NOT NULL, warnings text[] NOT NULL,
    FOREIGN KEY(scope_id,id) REFERENCES atlas_objects(scope_id,id), FOREIGN KEY(scope_id,area_id) REFERENCES atlas_objects(scope_id,id)
);
CREATE UNIQUE INDEX atlas_generations_current ON atlas_generations(scope_id,id) WHERE valid_to IS NULL;
CREATE TABLE atlas_water_transfers (
    revision_id uuid PRIMARY KEY, scope_id uuid NOT NULL, id uuid NOT NULL, valid_from bigint NOT NULL, valid_to bigint,
    FOREIGN KEY(scope_id,id) REFERENCES atlas_objects(scope_id,id)
);
CREATE UNIQUE INDEX atlas_water_transfers_current ON atlas_water_transfers(scope_id,id) WHERE valid_to IS NULL;
CREATE TABLE atlas_water_transfer_items (
    revision_id uuid NOT NULL REFERENCES atlas_water_transfers(revision_id), ordinal integer NOT NULL,
    feature_id uuid NOT NULL, point atlas_position NOT NULL, rate double precision NOT NULL, storage_id uuid NOT NULL, field_id uuid NOT NULL,
    PRIMARY KEY(revision_id,ordinal)
);
-- Derived, composed geometry includes child patches and follows dependencies.
CREATE TABLE atlas_feature_index (
    world_id uuid NOT NULL REFERENCES atlas_worlds(id), feature_id uuid NOT NULL, space_id uuid NOT NULL,
    layer_id text NOT NULL, geometry geometry NOT NULL, PRIMARY KEY(world_id,feature_id,space_id),
    FOREIGN KEY(world_id,feature_id) REFERENCES atlas_objects(scope_id,id), CHECK(ST_SRID(geometry)=0)
);
CREATE INDEX atlas_features_extent ON atlas_feature_index USING gist(world_id,space_id,geometry);

CREATE TABLE atlas_jobs (
    id uuid PRIMARY KEY, world_id uuid NOT NULL REFERENCES atlas_worlds(id), operation_id uuid NOT NULL, request_hash text NOT NULL,
    input_version bigint NOT NULL, area_id uuid NOT NULL, domains text[] NOT NULL, seed integer NOT NULL, quality text NOT NULL,
    status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','cancelling','cancelled','failed','completed')),
    stage text NOT NULL DEFAULT 'Queued', progress double precision NOT NULL DEFAULT 0, cancel_requested boolean NOT NULL DEFAULT false,
    lease_owner uuid, lease_expires timestamptz, attempt integer NOT NULL DEFAULT 1, error text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(world_id,operation_id),
    FOREIGN KEY(world_id,input_version) REFERENCES atlas_world_versions(world_id,version) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(world_id,area_id) REFERENCES atlas_objects(scope_id,id)
);
CREATE INDEX atlas_jobs_claim ON atlas_jobs(status,created_at);
CREATE INDEX atlas_jobs_world ON atlas_jobs(world_id,created_at DESC);

ALTER TABLE atlas_areas ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_layers ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_features ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_representations ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_entities ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_relations ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_attributes ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_stations ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_construction_events ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_cave_events ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_feature_positions ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_hypsometry ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_water_exchange ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_connections ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_nodes ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_reaches ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_magic ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_views ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_field_references ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_generations ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
ALTER TABLE atlas_water_transfers ADD FOREIGN KEY(revision_id) REFERENCES atlas_revision_owners(id);
