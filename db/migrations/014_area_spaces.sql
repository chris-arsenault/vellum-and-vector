ALTER TABLE atlas_areas ADD COLUMN space_id uuid;
UPDATE atlas_areas a SET space_id=COALESCE((
    WITH RECURSIVE lineage AS (
        SELECT a.id,a.parent_id,a.profile,a.context,(a.frame).floor AS floor,0 AS depth,ARRAY[a.id] AS path
        UNION ALL SELECT p.id,p.parent_id,p.profile,p.context,(p.frame).floor,l.depth+1,l.path||p.id
            FROM atlas_areas p JOIN lineage l ON p.id=l.parent_id
            WHERE p.scope_id=a.scope_id AND p.valid_from<=a.valid_from AND (p.valid_to IS NULL OR p.valid_to>a.valid_from)
                AND NOT p.id=ANY(l.path)
    ) SELECT id FROM lineage WHERE profile=4 OR context='cave' OR floor IS NOT NULL ORDER BY depth LIMIT 1
),a.scope_id);
ALTER TABLE atlas_areas ALTER COLUMN space_id SET NOT NULL;
CREATE INDEX atlas_areas_space ON atlas_areas(scope_id,space_id,valid_from,valid_to);
CREATE INDEX atlas_areas_extent ON atlas_areas USING gist(scope_id,space_id,footprint);
