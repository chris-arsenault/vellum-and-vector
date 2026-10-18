DO $$ DECLARE c record; BEGIN
    FOR c IN SELECT conname,conrelid::regclass AS relation,pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE contype='f' AND confdeltype='c' AND ((confrelid='atlas_resources'::regclass AND conrelid IN (
            'atlas_resource_facts'::regclass,'atlas_resource_lineage'::regclass,'atlas_resource_features'::regclass,
            'atlas_resource_entities'::regclass,'atlas_resource_relations'::regclass,'atlas_resource_connections'::regclass,
            'atlas_resource_nodes'::regclass,'atlas_resource_reaches'::regclass,'atlas_resource_history'::regclass,'atlas_resource_events'::regclass)) OR
            (confrelid='atlas_grids'::regclass AND conrelid='atlas_grid_water_bodies'::regclass) OR
            (confrelid='atlas_grid_water_bodies'::regclass AND conrelid IN ('atlas_grid_lake_slices'::regclass,'atlas_grid_body_flags'::regclass,'atlas_grid_body_positions'::regclass))) LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I %s',c.relation,c.conname,c.conname,replace(c.definition,' ON DELETE CASCADE',''));
    END LOOP;
END $$;
