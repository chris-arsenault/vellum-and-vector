WITH columns AS (
    SELECT f.map_id, f.revision, c.item->>'key' AS key, min(c.item->>'label') AS label,
           bool_or((c.item->>'numeric')::boolean) AS numeric, min(c.ordinal) AS position
    FROM map.features f
    CROSS JOIN LATERAL jsonb_array_elements(f.catalog->'columns')
        WITH ORDINALITY AS c(item,ordinal)
    GROUP BY f.map_id, f.revision, c.item->>'key'
), ordered AS (
    SELECT *, (row_number() OVER (PARTITION BY map_id,revision ORDER BY position,key) - 1)::integer AS ordinal
    FROM columns
)
INSERT INTO map.registry_columns(map_id,revision,key,label,numeric,ordinal)
SELECT map_id, revision, key, label, numeric, ordinal FROM ordered
ON CONFLICT (map_id,revision,key) DO UPDATE
SET numeric=map.registry_columns.numeric OR excluded.numeric;

UPDATE map.features SET catalog=catalog-'columns' WHERE catalog ? 'columns';
