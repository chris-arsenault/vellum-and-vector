CREATE INDEX atlas_area_extent ON atlas_areas USING gist(scope_id,space_id,footprint);
CREATE INDEX atlas_reach_start ON atlas_reaches(scope_id,start_id,valid_from,valid_to);
CREATE INDEX atlas_reach_end ON atlas_reaches(scope_id,end_id,valid_from,valid_to);
