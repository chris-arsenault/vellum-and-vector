ALTER TABLE atlas_connections ADD COLUMN a_node uuid, ADD COLUMN b_node uuid,
    ADD FOREIGN KEY(scope_id,a_node) REFERENCES atlas_objects(scope_id,id),
    ADD FOREIGN KEY(scope_id,b_node) REFERENCES atlas_objects(scope_id,id);
ALTER TABLE atlas_resource_connections ADD COLUMN a_node uuid, ADD COLUMN b_node uuid,
    ADD FOREIGN KEY(resource_id,a_node) REFERENCES atlas_resource_nodes(resource_id,id),
    ADD FOREIGN KEY(resource_id,b_node) REFERENCES atlas_resource_nodes(resource_id,id);
ALTER TABLE atlas_magic ADD COLUMN area_id uuid, ADD COLUMN space_id uuid,
    ADD FOREIGN KEY(scope_id,area_id) REFERENCES atlas_objects(scope_id,id);
CREATE INDEX atlas_magic_extent ON atlas_magic USING gist(scope_id,scope);
