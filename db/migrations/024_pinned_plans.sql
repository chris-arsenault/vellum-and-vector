INSERT INTO atlas_objects(scope_id,id,kind) SELECT id,id,'world' FROM atlas_worlds ON CONFLICT DO NOTHING;
ALTER TABLE atlas_runs ADD COLUMN plan_sealed boolean NOT NULL DEFAULT false;
UPDATE atlas_runs SET plan_sealed=true;
CREATE FUNCTION atlas_guard_run_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.plan_sealed AND ROW(NEW.id,NEW.world_id,NEW.operation_id,NEW.actor,NEW.request_hash,NEW.input_version,
        NEW.area_id,NEW.space_id,NEW.footprint,NEW.crs_id,NEW.time_context,NEW.resolution,NEW.workflow_scope,NEW.workflow_id,NEW.workflow_version,
        NEW.profile,NEW.variant,NEW.profile_version,NEW.parameters,NEW.seed,NEW.seed_scope,NEW.plan_hash,NEW.created_at,NEW.plan_sealed) IS DISTINCT FROM
        ROW(OLD.id,OLD.world_id,OLD.operation_id,OLD.actor,OLD.request_hash,OLD.input_version,
        OLD.area_id,OLD.space_id,OLD.footprint,OLD.crs_id,OLD.time_context,OLD.resolution,OLD.workflow_scope,OLD.workflow_id,OLD.workflow_version,
        OLD.profile,OLD.variant,OLD.profile_version,OLD.parameters,OLD.seed,OLD.seed_scope,OLD.plan_hash,OLD.created_at,OLD.plan_sealed) THEN
        RAISE EXCEPTION 'Run plans are immutable after submission';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER atlas_run_plan_immutable BEFORE UPDATE ON atlas_runs FOR EACH ROW EXECUTE FUNCTION atlas_guard_run_plan();
CREATE FUNCTION atlas_guard_run_plan_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS(SELECT FROM atlas_runs WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.run_id ELSE NEW.run_id END AND plan_sealed) OR
       (TG_OP='UPDATE' AND EXISTS(SELECT FROM atlas_runs WHERE id=OLD.run_id AND plan_sealed)) THEN
        RAISE EXCEPTION 'Submitted run plans are immutable';
    END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['atlas_run_plan_nodes','atlas_run_write_scopes','atlas_run_input_revisions','atlas_run_inputs'] LOOP
        EXECUTE format('CREATE TRIGGER run_plan_sealed BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION atlas_guard_run_plan_rows()',t);
    END LOOP;
END $$;
