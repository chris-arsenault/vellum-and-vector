DO $$ BEGIN
    IF EXISTS(SELECT FROM atlas_boundary_history) THEN
        RAISE EXCEPTION 'Generic inherited history needs an explicit downgrade transition';
    END IF;
END $$;
UPDATE atlas_areas a SET traits=ARRAY(SELECT ROW(t.field,array_position(ARRAY['hard','tendency','derived','exception'],t.kind)-1,
    t.minimum,t.maximum,t.cause,t.footprint)::atlas_trait FROM atlas_area_traits t WHERE t.revision_id=a.revision_id AND t.source='effective' ORDER BY t.ordinal),
    local_traits=CASE WHEN a.local_traits_defined THEN ARRAY(SELECT ROW(t.field,array_position(ARRAY['hard','tendency','derived','exception'],t.kind)-1,
    t.minimum,t.maximum,t.cause,t.footprint)::atlas_trait FROM atlas_area_traits t WHERE t.revision_id=a.revision_id AND t.source='local' ORDER BY t.ordinal) ELSE NULL END;
UPDATE atlas_areas a SET boundary=ROW(h.version::integer,h.parent_id,h.parent_version,
    ARRAY(SELECT ROW(c.feature_id,ROW(c.x,c.y,c.z)::atlas_position,c.kind,c.flow,c.elevation,c.direction,c.node_id,
        c.receiving_feature,c.flow_uncertainty,c.flow_minimum,c.flow_maximum)::atlas_crossing
        FROM atlas_boundary_crossings c WHERE c.revision_id=h.revision_id ORDER BY c.ordinal),
    ARRAY(SELECT ROW(ROW(s.x,s.y,s.z)::atlas_position,s.channels,s.values)::atlas_sample FROM atlas_boundary_samples s
        WHERE s.revision_id=h.revision_id AND s.ring=-1 ORDER BY s.ordinal),
    ARRAY(SELECT ROW(e.id,e.tectonics,e.hydrology,e.ice,e.coasts,e.temperature,e.sea_level)::atlas_epoch
        FROM atlas_boundary_epochs e WHERE e.revision_id=h.revision_id ORDER BY e.ordinal),
    CASE WHEN h.has_rings THEN ARRAY(SELECT ROW(ARRAY(SELECT ROW(ROW(s.x,s.y,s.z)::atlas_position,s.channels,s.values)::atlas_sample
        FROM atlas_boundary_samples s WHERE s.revision_id=r.revision_id AND s.ring=r.ring ORDER BY s.ordinal))::atlas_ring
        FROM atlas_boundary_rings r WHERE r.revision_id=h.revision_id AND r.ring>=0 ORDER BY r.ring) ELSE NULL END,
    CASE WHEN h.has_fluxes THEN ARRAY(SELECT ROW(f.id,ROW(f.x,f.y,f.z)::atlas_position,ROW(f.dx,f.dy,f.dz)::atlas_position,f.rate,f.crossing)::atlas_water_flux
        FROM atlas_boundary_fluxes f WHERE f.revision_id=h.revision_id ORDER BY f.ordinal) ELSE NULL END)::atlas_boundary
    FROM atlas_boundaries h WHERE a.revision_id=h.revision_id;
DROP TABLE atlas_boundary_history_resources, atlas_boundary_history, atlas_boundary_fluxes, atlas_boundary_epochs,
    atlas_boundary_samples, atlas_boundary_rings, atlas_boundary_crossings, atlas_boundaries, atlas_area_traits;
ALTER TABLE atlas_areas DROP COLUMN local_traits_defined;
