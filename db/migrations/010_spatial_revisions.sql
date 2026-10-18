CREATE TABLE atlas_spatial_revisions (
    scope_id uuid NOT NULL, feature_id uuid NOT NULL, space_id uuid NOT NULL,
    valid_from bigint NOT NULL CHECK(valid_from>0), valid_to bigint, layer_id text NOT NULL, geometry geometry NOT NULL,
    PRIMARY KEY(scope_id,feature_id,space_id,valid_from),
    FOREIGN KEY(scope_id,feature_id) REFERENCES atlas_objects(scope_id,id),
    CHECK(valid_to IS NULL OR valid_to>valid_from),
    CHECK(ST_SRID(geometry)=0 AND ST_IsValid(geometry) AND NOT ST_IsEmpty(geometry)),
    EXCLUDE USING gist(scope_id WITH =,feature_id WITH =,space_id WITH =,int8range(valid_from,valid_to,'[)') WITH &&)
);
CREATE INDEX atlas_spatial_revision_extent ON atlas_spatial_revisions USING gist(scope_id,space_id,geometry);
CREATE INDEX atlas_spatial_revision_layer ON atlas_spatial_revisions(scope_id,layer_id,valid_from,valid_to);
-- Backfill the known current view accurately. Earlier revisions are rebuilt
-- from their source representations during a retained-data transition.
INSERT INTO atlas_spatial_revisions(scope_id,feature_id,space_id,valid_from,layer_id,geometry)
    SELECT i.world_id,i.feature_id,i.space_id,w.version,i.layer_id,i.geometry
    FROM atlas_feature_index i JOIN atlas_worlds w ON w.id=i.world_id;
