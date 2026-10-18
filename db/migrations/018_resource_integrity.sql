ALTER TABLE atlas_resources ADD COLUMN source_version bigint;
UPDATE atlas_resources r SET source_version=COALESCE((SELECT input_version FROM atlas_runs WHERE id=r.run_id),r.published_version,
    (SELECT version FROM atlas_worlds WHERE id=r.world_id));
ALTER TABLE atlas_resources ALTER COLUMN source_version SET NOT NULL;
ALTER TABLE atlas_resources ADD FOREIGN KEY(world_id,source_version) REFERENCES atlas_world_versions(world_id,version);
ALTER TABLE atlas_resources ADD COLUMN sealed boolean NOT NULL DEFAULT false;
UPDATE atlas_resources SET sealed=true;
ALTER TABLE atlas_resource_reaches ADD COLUMN end_flow double precision;
ALTER TABLE atlas_resource_nodes ADD COLUMN water_level double precision;
ALTER TABLE atlas_resource_nodes ADD COLUMN ordinal integer NOT NULL DEFAULT 0;
ALTER TABLE atlas_resource_reaches ADD COLUMN ordinal integer NOT NULL DEFAULT 0;
CREATE FUNCTION atlas_guard_resource_root() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.sealed AND ROW(NEW.id,NEW.world_id,NEW.run_id,NEW.kind,NEW.revision,NEW.area_id,NEW.space_id,NEW.footprint,
        NEW.crs_id,NEW.time_context,NEW.resolution,NEW.unit,NEW.grid_id,NEW.values_id,NEW.content_hash,NEW.created_at,
        NEW.schema_id,NEW.schema_version,NEW.source_version,NEW.sealed) IS DISTINCT FROM
        ROW(OLD.id,OLD.world_id,OLD.run_id,OLD.kind,OLD.revision,OLD.area_id,OLD.space_id,OLD.footprint,
        OLD.crs_id,OLD.time_context,OLD.resolution,OLD.unit,OLD.grid_id,OLD.values_id,OLD.content_hash,OLD.created_at,
        OLD.schema_id,OLD.schema_version,OLD.source_version,OLD.sealed) THEN
        RAISE EXCEPTION 'Sealed resources are immutable';
    END IF;
    IF OLD.status='published' AND NEW.status<>'published' THEN RAISE EXCEPTION 'Published resources cannot be unpublished'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER atlas_resource_immutable BEFORE UPDATE ON atlas_resources FOR EACH ROW EXECUTE FUNCTION atlas_guard_resource_root();
CREATE FUNCTION atlas_guard_resource_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS(SELECT FROM atlas_resources WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.resource_id ELSE NEW.resource_id END AND sealed) OR
       (TG_OP='UPDATE' AND EXISTS(SELECT FROM atlas_resources WHERE id=OLD.resource_id AND sealed)) THEN
        RAISE EXCEPTION 'Sealed resource content is immutable';
    END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['atlas_resource_facts','atlas_resource_lineage','atlas_resource_features','atlas_resource_entities',
        'atlas_resource_relations','atlas_resource_connections','atlas_resource_nodes','atlas_resource_reaches','atlas_resource_history','atlas_resource_events'] LOOP
        EXECUTE format('CREATE TRIGGER resource_sealed BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION atlas_guard_resource_rows()',t);
    END LOOP;
END $$;
