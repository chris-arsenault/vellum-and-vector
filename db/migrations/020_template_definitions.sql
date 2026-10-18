ALTER TABLE atlas_template_definitions ADD COLUMN root_area_id uuid;
ALTER TABLE atlas_template_definitions ADD FOREIGN KEY(scope_id,root_area_id) REFERENCES atlas_objects(scope_id,id);
CREATE TABLE atlas_template_versions (
    owner text NOT NULL,id uuid NOT NULL,version bigint NOT NULL,definition_scope uuid NOT NULL UNIQUE REFERENCES atlas_template_definitions(scope_id),
    PRIMARY KEY(owner,id,version)
);
INSERT INTO atlas_template_versions SELECT s.owner,d.id,d.version,d.scope_id FROM atlas_template_definitions d JOIN atlas_scopes s ON s.id=d.scope_id;
CREATE TABLE atlas_template_constraints (
    scope_id uuid PRIMARY KEY REFERENCES atlas_template_definitions(scope_id),context_kinds text[],maximum_slope double precision,street_access boolean NOT NULL
);
INSERT INTO atlas_template_constraints SELECT scope_id,(requirements).context_kinds,(requirements).maximum_slope,(requirements).street_access
    FROM atlas_template_definitions WHERE requirements IS DISTINCT FROM NULL::atlas_template_requirements;
CREATE TABLE atlas_template_required_fields (
    scope_id uuid NOT NULL REFERENCES atlas_template_constraints(scope_id),ordinal integer NOT NULL,field text NOT NULL,kind integer NOT NULL,
    minimum double precision NOT NULL,maximum double precision NOT NULL,cause text,footprint geometry,PRIMARY KEY(scope_id,ordinal)
);
INSERT INTO atlas_template_required_fields SELECT d.scope_id,i.s-1,((d.requirements).fields[i.s]).field,((d.requirements).fields[i.s]).kind,
    ((d.requirements).fields[i.s]).minimum,((d.requirements).fields[i.s]).maximum,((d.requirements).fields[i.s]).cause,((d.requirements).fields[i.s]).scope
    FROM atlas_template_definitions d CROSS JOIN LATERAL generate_subscripts((d.requirements).fields,1) i(s);
CREATE TRIGGER atlas_template_version_immutable BEFORE UPDATE ON atlas_template_versions
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_version_change();
ALTER TABLE atlas_scopes ADD COLUMN sealed boolean NOT NULL DEFAULT false;
UPDATE atlas_scopes SET sealed=true WHERE kind='template';
CREATE TRIGGER atlas_scope_immutable BEFORE UPDATE ON atlas_scopes FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_root();
CREATE FUNCTION atlas_guard_template_rows() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_scope uuid; old_scope uuid;
BEGIN
    IF TG_ARGV[0]='scope' THEN
        row_scope:=CASE WHEN TG_OP='DELETE' THEN OLD.scope_id ELSE NEW.scope_id END;
        IF TG_OP='UPDATE' THEN old_scope:=OLD.scope_id; END IF;
    ELSIF TG_ARGV[0]='definition' THEN
        row_scope:=CASE WHEN TG_OP='DELETE' THEN OLD.definition_scope ELSE NEW.definition_scope END;
        IF TG_OP='UPDATE' THEN old_scope:=OLD.definition_scope; END IF;
    ELSE
        SELECT scope_id INTO row_scope FROM atlas_revision_owners WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
        IF TG_OP='UPDATE' THEN SELECT scope_id INTO old_scope FROM atlas_revision_owners WHERE id=OLD.revision_id; END IF;
    END IF;
    IF EXISTS(SELECT FROM atlas_scopes WHERE id IN (row_scope,old_scope) AND kind='template' AND sealed) THEN
        RAISE EXCEPTION 'Template definition content is immutable';
    END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['atlas_template_definitions','atlas_template_spaces','atlas_template_sockets','atlas_template_members',
        'atlas_template_context_refs','atlas_template_constraints','atlas_template_required_fields','atlas_objects',
        'atlas_areas','atlas_layers','atlas_features','atlas_entities','atlas_representations','atlas_nodes','atlas_reaches','atlas_connections'] LOOP
        EXECUTE format('CREATE TRIGGER template_sealed BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION atlas_guard_template_rows(''scope'')',t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['atlas_attributes','atlas_attribute_shapes','atlas_stations','atlas_feature_positions','atlas_construction_events',
        'atlas_cave_stations','atlas_cave_events','atlas_hypsometry','atlas_water_exchange','atlas_relations','atlas_area_traits','atlas_area_layers'] LOOP
        EXECUTE format('CREATE TRIGGER template_sealed BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION atlas_guard_template_rows(''revision'')',t);
    END LOOP;
END $$;
CREATE TRIGGER template_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_template_workflows
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_template_rows('definition');
