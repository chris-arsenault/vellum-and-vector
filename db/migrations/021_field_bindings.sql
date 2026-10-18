ALTER TABLE atlas_field_references DROP CONSTRAINT atlas_field_references_id_fkey;
ALTER TABLE atlas_field_references ADD COLUMN resource_id uuid,ADD COLUMN state text NOT NULL DEFAULT 'generated';
ALTER TABLE atlas_field_references ADD FOREIGN KEY(scope_id,resource_id) REFERENCES atlas_resources(world_id,id);
ALTER TABLE atlas_field_references ADD CHECK(state IN ('unmaterialized','generated','authored','protected','intentionallyEmpty','stale'));
CREATE TABLE atlas_field_patches (
    id uuid PRIMARY KEY,world_id uuid NOT NULL,field_id uuid NOT NULL,version bigint NOT NULL,footprint geometry NOT NULL,
    channels text[] NOT NULL,actor text NOT NULL,resource_id uuid NOT NULL,protected boolean NOT NULL,
    FOREIGN KEY(world_id,field_id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(world_id,resource_id) REFERENCES atlas_resources(world_id,id),
    FOREIGN KEY(world_id,version) REFERENCES atlas_world_versions(world_id,version),
    CHECK(ST_IsValid(footprint) AND NOT ST_IsEmpty(footprint) AND ST_SRID(footprint)=0)
);
CREATE INDEX atlas_field_patch_extent ON atlas_field_patches USING gist(world_id,field_id,footprint);
