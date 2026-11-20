ALTER TABLE map.history ADD COLUMN ordinal bigint;
WITH ordered AS (
    SELECT map_id, revision, id,
           row_number() OVER (PARTITION BY map_id, revision ORDER BY id) - 1 AS ordinal
    FROM map.history
)
UPDATE map.history h SET ordinal = o.ordinal
FROM ordered o
WHERE (h.map_id, h.revision, h.id) = (o.map_id, o.revision, o.id);
ALTER TABLE map.history ALTER COLUMN ordinal SET NOT NULL;
