ALTER TABLE atlas_field_references DROP CONSTRAINT atlas_field_references_id_fkey;
DROP TABLE atlas_field_human_epochs, atlas_field_transfers, atlas_field_budgets, atlas_field_links,
    atlas_field_epochs, atlas_field_protections, atlas_fields, atlas_grid_lake_slices, atlas_grid_water_bodies,
    atlas_grid_channels, atlas_grids;
DROP FUNCTION atlas_check_channel_length();
DROP TYPE atlas_human_event, atlas_budget, atlas_field_boundary;
