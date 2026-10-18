ALTER TABLE atlas_boundary_crossings ADD COLUMN flow_known boolean,ADD COLUMN elevation_known boolean;
DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['atlas_boundaries','atlas_boundary_crossings','atlas_boundary_rings','atlas_boundary_samples',
        'atlas_boundary_epochs','atlas_boundary_fluxes','atlas_boundary_history','atlas_boundary_history_resources'] LOOP
        EXECUTE format('CREATE TRIGGER template_sealed BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION atlas_guard_template_rows(''revision'')',t);
    END LOOP;
END $$;
