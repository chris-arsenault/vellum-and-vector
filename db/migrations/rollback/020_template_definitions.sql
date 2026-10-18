DROP TRIGGER template_sealed ON atlas_template_workflows;
DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['atlas_template_definitions','atlas_template_spaces','atlas_template_sockets','atlas_template_members',
        'atlas_template_context_refs','atlas_template_constraints','atlas_template_required_fields','atlas_objects',
        'atlas_areas','atlas_layers','atlas_features','atlas_entities','atlas_representations','atlas_nodes','atlas_reaches','atlas_connections',
        'atlas_attributes','atlas_attribute_shapes','atlas_stations','atlas_feature_positions','atlas_construction_events',
        'atlas_cave_stations','atlas_cave_events','atlas_hypsometry','atlas_water_exchange','atlas_relations','atlas_area_traits','atlas_area_layers'] LOOP
        EXECUTE format('DROP TRIGGER template_sealed ON %I',t);
    END LOOP;
END $$;
DROP FUNCTION atlas_guard_template_rows();
DROP TRIGGER atlas_scope_immutable ON atlas_scopes;
ALTER TABLE atlas_scopes DROP COLUMN sealed;
UPDATE atlas_template_definitions d SET requirements=ROW(c.context_kinds,
    ARRAY(SELECT ROW(f.field,f.kind,f.minimum,f.maximum,f.cause,f.footprint)::atlas_trait FROM atlas_template_required_fields f WHERE f.scope_id=d.scope_id ORDER BY ordinal),
    c.maximum_slope,c.street_access)::atlas_template_requirements FROM atlas_template_constraints c WHERE c.scope_id=d.scope_id;
DROP TABLE atlas_template_required_fields,atlas_template_constraints,atlas_template_versions;
ALTER TABLE atlas_template_definitions DROP COLUMN root_area_id;
