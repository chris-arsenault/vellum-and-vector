ALTER TABLE atlas_layers ADD COLUMN representations text[],ADD COLUMN facts text[];
ALTER TABLE atlas_layers ADD CHECK(representations IS NULL OR (cardinality(representations)>0 AND representations<@ARRAY['vector','field','network']::text[] AND representation=ANY(representations)));
