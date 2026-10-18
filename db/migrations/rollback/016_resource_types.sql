DROP TABLE atlas_workflow_port_channels;
ALTER TABLE atlas_workflow_ports DROP COLUMN schema_version,DROP COLUMN schema_id;
ALTER TABLE atlas_resources DROP COLUMN schema_version,DROP COLUMN schema_id;
