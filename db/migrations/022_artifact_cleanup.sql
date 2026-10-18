-- Owning content follows its immutable artifact. References from checkpoints,
-- committed bindings, history and other artifacts retain their NO ACTION FKs.
DO $$ DECLARE c record; BEGIN
    FOR c IN SELECT conname,conrelid::regclass AS relation,pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE contype='f' AND confrelid='atlas_resources'::regclass AND conrelid IN (
            'atlas_resource_facts'::regclass,'atlas_resource_lineage'::regclass,'atlas_resource_features'::regclass,
            'atlas_resource_entities'::regclass,'atlas_resource_relations'::regclass,'atlas_resource_connections'::regclass,
            'atlas_resource_nodes'::regclass,'atlas_resource_reaches'::regclass,'atlas_resource_history'::regclass,'atlas_resource_events'::regclass)
        AND conkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=conrelid AND attname='resource_id')]::smallint[] LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I %s ON DELETE CASCADE',c.relation,c.conname,c.conname,c.definition);
    END LOOP;
    FOR c IN SELECT conname,conrelid::regclass AS relation,pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE contype='f' AND ((confrelid='atlas_grids'::regclass AND conrelid IN ('atlas_grid_water_bodies'::regclass)) OR
            (confrelid='atlas_grid_water_bodies'::regclass AND conrelid IN ('atlas_grid_lake_slices'::regclass,'atlas_grid_body_flags'::regclass,'atlas_grid_body_positions'::regclass))) LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I %s ON DELETE CASCADE',c.relation,c.conname,c.conname,c.definition);
    END LOOP;
END $$;
