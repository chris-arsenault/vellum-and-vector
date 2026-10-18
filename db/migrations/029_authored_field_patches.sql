ALTER TABLE atlas_field_patches ADD COLUMN scope_id uuid, ADD COLUMN revision_id uuid,
    ADD COLUMN valid_from bigint, ADD COLUMN valid_to bigint, ADD COLUMN area_id uuid, ADD COLUMN space_id uuid,
    ADD COLUMN created_version bigint;
UPDATE atlas_field_patches p SET scope_id=p.world_id,revision_id=gen_random_uuid(),valid_from=p.version,
    area_id=r.area_id,space_id=r.space_id,created_version=p.version FROM atlas_resources r WHERE r.id=p.resource_id;
INSERT INTO atlas_revision_owners(id,scope_id) SELECT revision_id,scope_id FROM atlas_field_patches;
INSERT INTO atlas_objects(scope_id,id,kind) SELECT scope_id,id,'fieldPatch' FROM atlas_field_patches ON CONFLICT DO NOTHING;
ALTER TABLE atlas_field_patches DROP CONSTRAINT atlas_field_patches_pkey;
ALTER TABLE atlas_field_patches ALTER COLUMN scope_id SET NOT NULL, ALTER COLUMN revision_id SET NOT NULL,
    ALTER COLUMN valid_from SET NOT NULL, ALTER COLUMN area_id SET NOT NULL, ALTER COLUMN space_id SET NOT NULL,
    ALTER COLUMN created_version SET NOT NULL;
ALTER TABLE atlas_field_patches ADD PRIMARY KEY(revision_id),
    ADD FOREIGN KEY(scope_id,revision_id) REFERENCES atlas_revision_owners(scope_id,id),
    ADD FOREIGN KEY(scope_id,id) REFERENCES atlas_objects(scope_id,id),
    ADD FOREIGN KEY(scope_id,area_id) REFERENCES atlas_objects(scope_id,id),
    ADD CHECK(world_id=scope_id AND version=valid_from),
    ADD CHECK(valid_to IS NULL OR valid_to>valid_from);
ALTER TABLE atlas_field_patches ADD FOREIGN KEY(scope_id,created_version) REFERENCES atlas_world_versions(world_id,version),
    ADD CHECK(created_version<=valid_from);
CREATE FUNCTION atlas_guard_patch_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS(SELECT FROM atlas_field_patches p WHERE p.scope_id=NEW.scope_id AND p.id=NEW.id
      AND ROW(p.field_id,p.area_id,p.space_id,p.footprint,p.channels,p.resource_id,p.created_version) IS DISTINCT FROM
          ROW(NEW.field_id,NEW.area_id,NEW.space_id,NEW.footprint,NEW.channels,NEW.resource_id,NEW.created_version)) THEN
        RAISE EXCEPTION 'An authored patch retains its content, extent and precedence across metadata revisions';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER atlas_patch_identity BEFORE INSERT ON atlas_field_patches FOR EACH ROW EXECUTE FUNCTION atlas_guard_patch_identity();
CREATE UNIQUE INDEX atlas_field_patches_current ON atlas_field_patches(scope_id,id) WHERE valid_to IS NULL;
CREATE INDEX atlas_field_patch_temporal ON atlas_field_patches(scope_id,field_id,valid_from,valid_to);
CREATE TABLE atlas_operation_artifacts (
    world_id uuid NOT NULL,operation_id uuid NOT NULL,resource_id uuid NOT NULL,
    PRIMARY KEY(world_id,operation_id,resource_id),
    FOREIGN KEY(world_id,operation_id) REFERENCES atlas_operations(world_id,operation_id),
    FOREIGN KEY(world_id,resource_id) REFERENCES atlas_resources(world_id,id)
);
