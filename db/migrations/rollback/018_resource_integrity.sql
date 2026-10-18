DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['atlas_resource_facts','atlas_resource_lineage','atlas_resource_features','atlas_resource_entities',
        'atlas_resource_relations','atlas_resource_connections','atlas_resource_nodes','atlas_resource_reaches','atlas_resource_history','atlas_resource_events'] LOOP
        EXECUTE format('DROP TRIGGER resource_sealed ON %I',t);
    END LOOP;
END $$;
DROP FUNCTION atlas_guard_resource_rows();
DROP TRIGGER atlas_resource_immutable ON atlas_resources;
DROP FUNCTION atlas_guard_resource_root();
ALTER TABLE atlas_resource_nodes DROP COLUMN water_level,DROP COLUMN ordinal;
ALTER TABLE atlas_resource_reaches DROP COLUMN end_flow,DROP COLUMN ordinal;
ALTER TABLE atlas_resources DROP COLUMN sealed,DROP COLUMN source_version;
