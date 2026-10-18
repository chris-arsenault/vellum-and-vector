CREATE INDEX atlas_nodes_extent ON atlas_nodes USING gist(scope_id,COALESCE(space_id,scope_id),ST_SetSRID(ST_MakePoint((point).x,(point).y),0));
CREATE INDEX atlas_reaches_extent ON atlas_reaches USING gist(scope_id,geometry);
CREATE INDEX atlas_reaches_feature ON atlas_reaches(scope_id,feature_id,valid_from,valid_to);
CREATE INDEX atlas_connections_end_a ON atlas_connections(scope_id,a_area,valid_from,valid_to);
CREATE INDEX atlas_connections_end_b ON atlas_connections(scope_id,b_area,valid_from,valid_to);
CREATE INDEX atlas_relations_target ON atlas_relations(scope_id,target_id,kind);
