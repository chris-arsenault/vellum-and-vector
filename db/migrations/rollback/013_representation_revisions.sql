-- Independent representation revisions cannot always be expressed by the old
-- feature-owned snapshot shape. Require an explicit transition before downgrade.
DO $$ BEGIN
    IF EXISTS(SELECT FROM atlas_representations r JOIN atlas_features f ON f.revision_id=r.feature_revision
        WHERE r.valid_from<>f.valid_from OR r.valid_to IS DISTINCT FROM f.valid_to) THEN
        RAISE EXCEPTION 'Independent representation history needs an explicit downgrade transition';
    END IF;
END $$;
DROP INDEX atlas_representations_extent,atlas_representations_feature,atlas_representations_current;
ALTER TABLE atlas_representations DROP CONSTRAINT atlas_representation_revision_overlap;
ALTER TABLE atlas_representations DROP COLUMN valid_to,DROP COLUMN valid_from,DROP COLUMN feature_id,DROP COLUMN id;
ALTER TABLE atlas_representations ADD UNIQUE(feature_revision,area_id);
ALTER TABLE atlas_representation_ids DROP CONSTRAINT atlas_representation_identity_object;
DELETE FROM atlas_objects o USING atlas_representation_ids i WHERE o.scope_id=i.scope_id AND o.id=i.id;
DROP TABLE atlas_representation_ids;
