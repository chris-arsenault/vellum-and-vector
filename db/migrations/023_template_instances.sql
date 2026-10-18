CREATE TABLE atlas_layer_ids (scope_id uuid NOT NULL REFERENCES atlas_scopes(id),id text NOT NULL,PRIMARY KEY(scope_id,id));
INSERT INTO atlas_layer_ids SELECT DISTINCT scope_id,id FROM atlas_layers;
ALTER TABLE atlas_layers ADD FOREIGN KEY(scope_id,id) REFERENCES atlas_layer_ids(scope_id,id);
CREATE TABLE atlas_template_instances (
    world_id uuid NOT NULL,id uuid NOT NULL,definition_scope uuid NOT NULL REFERENCES atlas_template_definitions(scope_id),
    root_area_id uuid NOT NULL,created_version bigint NOT NULL,PRIMARY KEY(world_id,id),
    FOREIGN KEY(world_id,id) REFERENCES atlas_objects(scope_id,id),FOREIGN KEY(world_id,root_area_id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(world_id,created_version) REFERENCES atlas_world_versions(world_id,version)
);
CREATE TABLE atlas_template_instance_layers (
    world_id uuid NOT NULL,instance_id uuid NOT NULL,definition_scope uuid NOT NULL,definition_id text NOT NULL,layer_id text NOT NULL,
    PRIMARY KEY(world_id,instance_id,definition_id),FOREIGN KEY(world_id,instance_id) REFERENCES atlas_template_instances(world_id,id),
    FOREIGN KEY(definition_scope,definition_id) REFERENCES atlas_layer_ids(scope_id,id),FOREIGN KEY(world_id,layer_id) REFERENCES atlas_layer_ids(scope_id,id)
);
CREATE TRIGGER atlas_template_instance_immutable BEFORE UPDATE ON atlas_template_instances FOR EACH ROW EXECUTE FUNCTION atlas_guard_version_change();
CREATE TRIGGER atlas_template_instance_member_immutable BEFORE UPDATE ON atlas_template_instance_members FOR EACH ROW EXECUTE FUNCTION atlas_guard_version_change();
CREATE TRIGGER atlas_template_instance_layer_immutable BEFORE UPDATE ON atlas_template_instance_layers FOR EACH ROW EXECUTE FUNCTION atlas_guard_version_change();
CREATE TRIGGER template_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_layer_ids FOR EACH ROW EXECUTE FUNCTION atlas_guard_template_rows('scope');
