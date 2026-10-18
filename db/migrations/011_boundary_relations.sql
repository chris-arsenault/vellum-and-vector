ALTER TABLE atlas_areas ADD COLUMN local_traits_defined boolean NOT NULL DEFAULT false;
UPDATE atlas_areas SET local_traits_defined=local_traits IS NOT NULL;
CREATE TABLE atlas_area_traits (
    revision_id uuid NOT NULL REFERENCES atlas_areas(revision_id), source text NOT NULL CHECK(source IN ('effective','local')),
    ordinal integer NOT NULL, field text NOT NULL, kind text NOT NULL CHECK(kind IN ('hard','tendency','derived','exception')),
    minimum double precision NOT NULL, maximum double precision NOT NULL, cause text, footprint geometry,
    PRIMARY KEY(revision_id,source,ordinal), CHECK(minimum<=maximum),
    CHECK(footprint IS NULL OR (ST_SRID(footprint)=0 AND ST_IsValid(footprint)))
);
INSERT INTO atlas_area_traits SELECT a.revision_id,'effective',s.i-1,(a.traits[s.i]).field,
    (ARRAY['hard','tendency','derived','exception'])[(a.traits[s.i]).kind+1],(a.traits[s.i]).minimum,(a.traits[s.i]).maximum,
    (a.traits[s.i]).cause,(a.traits[s.i]).scope FROM atlas_areas a CROSS JOIN LATERAL generate_subscripts(a.traits,1) s(i);
INSERT INTO atlas_area_traits SELECT a.revision_id,'local',s.i-1,(a.local_traits[s.i]).field,
    (ARRAY['hard','tendency','derived','exception'])[(a.local_traits[s.i]).kind+1],(a.local_traits[s.i]).minimum,(a.local_traits[s.i]).maximum,
    (a.local_traits[s.i]).cause,(a.local_traits[s.i]).scope FROM atlas_areas a CROSS JOIN LATERAL generate_subscripts(a.local_traits,1) s(i);
CREATE TABLE atlas_boundaries (
    revision_id uuid PRIMARY KEY REFERENCES atlas_areas(revision_id), scope_id uuid NOT NULL,
    version bigint NOT NULL, parent_id uuid NOT NULL, parent_version bigint NOT NULL,
    has_rings boolean NOT NULL, has_fluxes boolean NOT NULL,
    FOREIGN KEY(scope_id,revision_id) REFERENCES atlas_revision_owners(scope_id,id),
    FOREIGN KEY(scope_id,parent_id) REFERENCES atlas_objects(scope_id,id)
);
INSERT INTO atlas_boundaries SELECT revision_id,scope_id,(boundary).version,(boundary).parent_id,(boundary).parent_version,
    (boundary).rings IS NOT NULL,(boundary).water_fluxes IS NOT NULL FROM atlas_areas WHERE boundary IS DISTINCT FROM NULL::atlas_boundary;
CREATE TABLE atlas_boundary_crossings (
    revision_id uuid NOT NULL REFERENCES atlas_boundaries(revision_id), ordinal integer NOT NULL,
    feature_id uuid NOT NULL, x double precision NOT NULL, y double precision NOT NULL, z double precision NOT NULL,
    kind text NOT NULL, flow double precision NOT NULL, elevation double precision NOT NULL, direction text NOT NULL,
    node_id uuid, receiving_feature uuid, flow_uncertainty double precision NOT NULL, flow_minimum double precision, flow_maximum double precision,
    PRIMARY KEY(revision_id,ordinal)
);
INSERT INTO atlas_boundary_crossings SELECT a.revision_id,s.i-1,(c.value).feature_id,
    ((c.value).point).x,((c.value).point).y,((c.value).point).z,(c.value).kind,(c.value).flow,(c.value).elevation,
    (c.value).direction,(c.value).node_id,(c.value).receiving_feature_id,(c.value).flow_uncertainty,(c.value).flow_minimum,(c.value).flow_maximum
    FROM atlas_areas a CROSS JOIN LATERAL generate_subscripts((a.boundary).crossings,1) s(i)
    CROSS JOIN LATERAL (SELECT ((a.boundary).crossings)[s.i] AS value) c;
CREATE TABLE atlas_boundary_rings (
    revision_id uuid NOT NULL REFERENCES atlas_boundaries(revision_id), ring integer NOT NULL CHECK(ring>=-1), PRIMARY KEY(revision_id,ring)
);
INSERT INTO atlas_boundary_rings SELECT revision_id,-1 FROM atlas_boundaries;
INSERT INTO atlas_boundary_rings SELECT a.revision_id,s.i-1 FROM atlas_areas a CROSS JOIN LATERAL generate_subscripts((a.boundary).rings,1) s(i);
CREATE TABLE atlas_boundary_samples (
    revision_id uuid NOT NULL, ring integer NOT NULL, ordinal integer NOT NULL,
    x double precision NOT NULL, y double precision NOT NULL, z double precision NOT NULL,
    channels text[] NOT NULL, values double precision[] NOT NULL,
    PRIMARY KEY(revision_id,ring,ordinal), FOREIGN KEY(revision_id,ring) REFERENCES atlas_boundary_rings(revision_id,ring),
    CHECK(cardinality(channels)=cardinality(values)), CHECK(cardinality(values)=0 OR atlas_finite_array(values))
);
INSERT INTO atlas_boundary_samples SELECT a.revision_id,-1,s.i-1,((p.value).point).x,((p.value).point).y,((p.value).point).z,(p.value).channels,(p.value).values
    FROM atlas_areas a CROSS JOIN LATERAL generate_subscripts((a.boundary).samples,1) s(i)
    CROSS JOIN LATERAL (SELECT ((a.boundary).samples)[s.i] AS value) p;
INSERT INTO atlas_boundary_samples SELECT a.revision_id,s.i-1,t.j-1,((p.value).point).x,((p.value).point).y,((p.value).point).z,(p.value).channels,(p.value).values
    FROM atlas_areas a CROSS JOIN LATERAL generate_subscripts((a.boundary).rings,1) s(i)
    CROSS JOIN LATERAL (SELECT (((a.boundary).rings)[s.i]).samples AS samples) r
    CROSS JOIN LATERAL generate_subscripts(r.samples,1) t(j) CROSS JOIN LATERAL (SELECT r.samples[t.j] AS value) p;
CREATE TABLE atlas_boundary_epochs (
    revision_id uuid NOT NULL REFERENCES atlas_boundaries(revision_id), ordinal integer NOT NULL,
    id text NOT NULL, tectonics integer NOT NULL, hydrology integer NOT NULL, ice integer NOT NULL,
    coasts integer NOT NULL, temperature integer NOT NULL, sea_level integer NOT NULL,
    PRIMARY KEY(revision_id,ordinal)
);
INSERT INTO atlas_boundary_epochs SELECT a.revision_id,s.i-1,(e.value).id,(e.value).tectonics,(e.value).hydrology,(e.value).ice,
    (e.value).coasts,(e.value).temperature,(e.value).sea_level FROM atlas_areas a
    CROSS JOIN LATERAL generate_subscripts((a.boundary).epochs,1) s(i) CROSS JOIN LATERAL (SELECT ((a.boundary).epochs)[s.i] AS value) e;
CREATE TABLE atlas_boundary_fluxes (
    revision_id uuid NOT NULL REFERENCES atlas_boundaries(revision_id), ordinal integer NOT NULL, id uuid NOT NULL,
    x double precision NOT NULL,y double precision NOT NULL,z double precision NOT NULL,
    dx double precision NOT NULL,dy double precision NOT NULL,dz double precision NOT NULL,rate double precision NOT NULL,crossing text NOT NULL,
    PRIMARY KEY(revision_id,ordinal)
);
INSERT INTO atlas_boundary_fluxes SELECT a.revision_id,s.i-1,(f.value).id,((f.value).point).x,((f.value).point).y,((f.value).point).z,
    ((f.value).direction).x,((f.value).direction).y,((f.value).direction).z,(f.value).rate,(f.value).crossing FROM atlas_areas a
    CROSS JOIN LATERAL generate_subscripts((a.boundary).water_fluxes,1) s(i)
    CROSS JOIN LATERAL (SELECT ((a.boundary).water_fluxes)[s.i] AS value) f;
CREATE TABLE atlas_boundary_history (
    revision_id uuid NOT NULL REFERENCES atlas_boundaries(revision_id), ordinal integer NOT NULL, scope_id uuid NOT NULL,
    epoch_id text NOT NULL, parent_epoch text, forcing uuid,
    PRIMARY KEY(revision_id,ordinal), FOREIGN KEY(scope_id,forcing) REFERENCES atlas_value_sets(scope_id,id)
);
CREATE TABLE atlas_boundary_history_resources (
    revision_id uuid NOT NULL, epoch_ordinal integer NOT NULL, ordinal integer NOT NULL, scope_id uuid NOT NULL, resource_id uuid NOT NULL,
    PRIMARY KEY(revision_id,epoch_ordinal,ordinal), FOREIGN KEY(revision_id,epoch_ordinal) REFERENCES atlas_boundary_history(revision_id,ordinal),
    FOREIGN KEY(scope_id,resource_id) REFERENCES atlas_resources(world_id,id)
);
