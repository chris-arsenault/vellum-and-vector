CREATE TABLE atlas_grid_body_flags (
    grid_id uuid NOT NULL,body_ordinal integer NOT NULL,has_outlet_path boolean NOT NULL,
    PRIMARY KEY(grid_id,body_ordinal),FOREIGN KEY(grid_id,body_ordinal) REFERENCES atlas_grid_water_bodies(grid_id,ordinal)
);
CREATE TABLE atlas_grid_body_positions (
    grid_id uuid NOT NULL,body_ordinal integer NOT NULL,role text NOT NULL CHECK(role IN ('outlet','outletFrom','path')),
    ordinal integer NOT NULL,x double precision NOT NULL,y double precision NOT NULL,z double precision NOT NULL,
    PRIMARY KEY(grid_id,body_ordinal,role,ordinal),FOREIGN KEY(grid_id,body_ordinal) REFERENCES atlas_grid_water_bodies(grid_id,ordinal)
);
INSERT INTO atlas_grid_body_flags SELECT grid_id,ordinal,outlet_path IS NOT NULL FROM atlas_grid_water_bodies;
INSERT INTO atlas_grid_body_positions SELECT grid_id,ordinal,'outlet',0,(outlet).x,(outlet).y,(outlet).z FROM atlas_grid_water_bodies WHERE outlet IS DISTINCT FROM NULL::atlas_position;
INSERT INTO atlas_grid_body_positions SELECT grid_id,ordinal,'outletFrom',0,(outlet_from).x,(outlet_from).y,(outlet_from).z FROM atlas_grid_water_bodies WHERE outlet_from IS DISTINCT FROM NULL::atlas_position;
INSERT INTO atlas_grid_body_positions SELECT b.grid_id,b.ordinal,'path',s.i-1,(b.outlet_path[s.i]).x,(b.outlet_path[s.i]).y,(b.outlet_path[s.i]).z
    FROM atlas_grid_water_bodies b CROSS JOIN LATERAL generate_subscripts(b.outlet_path,1) s(i);
CREATE TRIGGER artifact_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_grid_body_flags
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_grid_rows();
CREATE TRIGGER artifact_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_grid_body_positions
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_grid_rows();
