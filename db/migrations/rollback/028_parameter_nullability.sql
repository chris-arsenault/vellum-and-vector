DO $$ BEGIN
    IF EXISTS(SELECT FROM atlas_parameter_definitions WHERE allow_null=true) THEN
        RAISE EXCEPTION 'Replace or export nullable workflow definitions before downgrading their parameter schema';
    END IF;
END $$;
ALTER TABLE atlas_parameter_definitions DROP COLUMN allow_null;
