ALTER TABLE atlas_operations ADD COLUMN command_version integer NOT NULL DEFAULT 1 CHECK(command_version>0);
ALTER TABLE atlas_operations ADD COLUMN sealed boolean NOT NULL DEFAULT true;
ALTER TABLE atlas_operation_changes ADD CONSTRAINT atlas_operation_change_before_owner FOREIGN KEY(world_id,before_revision) REFERENCES atlas_revision_owners(scope_id,id);
ALTER TABLE atlas_operation_changes ADD CONSTRAINT atlas_operation_change_after_owner FOREIGN KEY(world_id,after_revision) REFERENCES atlas_revision_owners(scope_id,id);
CREATE TABLE atlas_operation_parameters (
    world_id uuid NOT NULL, operation_id uuid NOT NULL, parameters uuid NOT NULL,
    PRIMARY KEY(world_id,operation_id), FOREIGN KEY(world_id,operation_id) REFERENCES atlas_operations(world_id,operation_id),
    FOREIGN KEY(world_id,parameters) REFERENCES atlas_value_sets(scope_id,id)
);
CREATE TABLE atlas_operation_inputs (
    world_id uuid NOT NULL, operation_id uuid NOT NULL, ordinal integer NOT NULL, role text NOT NULL,
    kind text NOT NULL, object_id text NOT NULL, revision_id uuid NOT NULL, version bigint NOT NULL,
    PRIMARY KEY(world_id,operation_id,ordinal), FOREIGN KEY(world_id,operation_id) REFERENCES atlas_operations(world_id,operation_id),
    FOREIGN KEY(world_id,revision_id) REFERENCES atlas_revision_owners(scope_id,id)
);
CREATE TABLE atlas_operation_scopes (
    world_id uuid NOT NULL, operation_id uuid NOT NULL, ordinal integer NOT NULL,
    role text NOT NULL CHECK(role IN ('read','write')), space_id uuid NOT NULL, footprint geometry NOT NULL,
    PRIMARY KEY(world_id,operation_id,ordinal), FOREIGN KEY(world_id,operation_id) REFERENCES atlas_operations(world_id,operation_id),
    CHECK(ST_SRID(footprint)=0 AND ST_IsValid(footprint) AND NOT ST_IsEmpty(footprint))
);
CREATE TABLE atlas_operation_world_changes (
    world_id uuid NOT NULL, operation_id uuid NOT NULL, before_version bigint NOT NULL, after_version bigint NOT NULL,
    PRIMARY KEY(world_id,operation_id), FOREIGN KEY(world_id,operation_id) REFERENCES atlas_operations(world_id,operation_id),
    FOREIGN KEY(world_id,before_version) REFERENCES atlas_world_versions(world_id,version),
    FOREIGN KEY(world_id,after_version) REFERENCES atlas_world_versions(world_id,version)
);
CREATE TRIGGER atlas_operation_immutable BEFORE UPDATE ON atlas_operations
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_root();
CREATE FUNCTION atlas_guard_operation_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS(SELECT FROM atlas_operations WHERE world_id=CASE WHEN TG_OP='DELETE' THEN OLD.world_id ELSE NEW.world_id END
        AND operation_id=CASE WHEN TG_OP='DELETE' THEN OLD.operation_id ELSE NEW.operation_id END AND sealed) OR
       (TG_OP='UPDATE' AND EXISTS(SELECT FROM atlas_operations WHERE world_id=OLD.world_id AND operation_id=OLD.operation_id AND sealed)) THEN
        RAISE EXCEPTION 'Committed operation records are immutable';
    END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE table_name text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['atlas_operation_parameters','atlas_operation_inputs','atlas_operation_scopes',
        'atlas_operation_changes','atlas_operation_world_changes'] LOOP
        EXECUTE format('CREATE TRIGGER operation_sealed BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION atlas_guard_operation_rows()',table_name);
    END LOOP;
END $$;
