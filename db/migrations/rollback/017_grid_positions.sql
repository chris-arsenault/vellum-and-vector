-- The old columns remain available for the supported downgrade path.
-- Only this representation transition may rewrite sealed body rows. The
-- migration runner holds its transaction until the guard has been restored.
ALTER TABLE atlas_grid_water_bodies DISABLE TRIGGER artifact_sealed;
UPDATE atlas_grid_water_bodies b SET outlet=(SELECT ROW(p.x,p.y,p.z)::atlas_position FROM atlas_grid_body_positions p WHERE p.grid_id=b.grid_id AND p.body_ordinal=b.ordinal AND p.role='outlet'),
    outlet_from=(SELECT ROW(p.x,p.y,p.z)::atlas_position FROM atlas_grid_body_positions p WHERE p.grid_id=b.grid_id AND p.body_ordinal=b.ordinal AND p.role='outletFrom'),
    outlet_path=CASE WHEN f.has_outlet_path THEN ARRAY(SELECT ROW(p.x,p.y,p.z)::atlas_position FROM atlas_grid_body_positions p
        WHERE p.grid_id=b.grid_id AND p.body_ordinal=b.ordinal AND p.role='path' ORDER BY p.ordinal) ELSE NULL END
    FROM atlas_grid_body_flags f WHERE f.grid_id=b.grid_id AND f.body_ordinal=b.ordinal;
ALTER TABLE atlas_grid_water_bodies ENABLE TRIGGER artifact_sealed;
DROP TABLE atlas_grid_body_positions,atlas_grid_body_flags;
