ALTER TABLE atlas_resources ADD COLUMN schema_id text;
ALTER TABLE atlas_resources ADD COLUMN schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version>0);
UPDATE atlas_resources r SET schema_id=COALESCE((SELECT v.schema_id FROM atlas_value_sets v WHERE v.id=r.values_id),
    CASE r.kind WHEN 'field' THEN 'atlas.grid' WHEN 'vector' THEN 'atlas.features' WHEN 'network' THEN 'atlas.network'
        WHEN 'entities' THEN 'atlas.entities' WHEN 'history' THEN 'atlas.history' ELSE 'atlas.value' END);
ALTER TABLE atlas_resources ALTER COLUMN schema_id SET NOT NULL;
ALTER TABLE atlas_workflow_ports ADD COLUMN schema_id text;
ALTER TABLE atlas_workflow_ports ADD COLUMN schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version>0);
UPDATE atlas_workflow_ports SET schema_id=CASE resource_kind WHEN 'field' THEN 'atlas.grid' WHEN 'vector' THEN 'atlas.features'
    WHEN 'network' THEN 'atlas.network' WHEN 'entities' THEN 'atlas.entities' WHEN 'history' THEN 'atlas.history' ELSE 'atlas.value' END;
ALTER TABLE atlas_workflow_ports ALTER COLUMN schema_id SET NOT NULL;
CREATE TABLE atlas_workflow_port_channels (
    scope_id uuid NOT NULL,workflow_id text NOT NULL,workflow_version bigint NOT NULL,owner_node text NOT NULL,
    direction text NOT NULL,name text NOT NULL,channel text NOT NULL,unit text NOT NULL,
    PRIMARY KEY(scope_id,workflow_id,workflow_version,owner_node,direction,name,channel),
    FOREIGN KEY(scope_id,workflow_id,workflow_version,owner_node,direction,name)
        REFERENCES atlas_workflow_ports(scope_id,workflow_id,workflow_version,owner_node,direction,name)
);
CREATE TRIGGER workflow_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_workflow_port_channels
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_workflow();
