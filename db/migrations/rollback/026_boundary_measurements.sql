DO $$ DECLARE t text; BEGIN
    IF EXISTS(SELECT FROM atlas_boundary_crossings WHERE flow_known=false OR elevation_known=false) THEN
        RAISE EXCEPTION 'Resolve or export explicitly unknown boundary measurements before downgrading their representation';
    END IF;
    FOREACH t IN ARRAY ARRAY['atlas_boundaries','atlas_boundary_crossings','atlas_boundary_rings','atlas_boundary_samples',
        'atlas_boundary_epochs','atlas_boundary_fluxes','atlas_boundary_history','atlas_boundary_history_resources'] LOOP
        EXECUTE format('DROP TRIGGER template_sealed ON %I',t);
    END LOOP;
END $$;
ALTER TABLE atlas_boundary_crossings DROP COLUMN flow_known,DROP COLUMN elevation_known;
