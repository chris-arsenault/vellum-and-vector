DO $$ BEGIN
    IF EXISTS(SELECT FROM atlas_connections WHERE a_node IS NOT NULL OR b_node IS NOT NULL)
        OR EXISTS(SELECT FROM atlas_resource_connections WHERE a_node IS NOT NULL OR b_node IS NOT NULL)
        OR EXISTS(SELECT FROM atlas_magic WHERE area_id IS NOT NULL OR space_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Located connections and magical sources require an explicit downgrade transition';
    END IF;
END $$;
DROP INDEX atlas_magic_extent;
ALTER TABLE atlas_magic DROP COLUMN area_id,DROP COLUMN space_id;
ALTER TABLE atlas_resource_connections DROP COLUMN a_node,DROP COLUMN b_node;
ALTER TABLE atlas_connections DROP COLUMN a_node,DROP COLUMN b_node;
