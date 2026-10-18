CREATE TABLE atlas_representation_ids (
    scope_id uuid NOT NULL, feature_id uuid NOT NULL, area_id uuid NOT NULL, id uuid NOT NULL,
    PRIMARY KEY(scope_id,feature_id,area_id), UNIQUE(scope_id,id),
    FOREIGN KEY(scope_id,feature_id) REFERENCES atlas_objects(scope_id,id),
    FOREIGN KEY(scope_id,area_id) REFERENCES atlas_objects(scope_id,id)
);
INSERT INTO atlas_representation_ids SELECT r.scope_id,f.id,r.area_id,gen_random_uuid()
    FROM atlas_representations r JOIN atlas_features f ON f.revision_id=r.feature_revision GROUP BY r.scope_id,f.id,r.area_id;
INSERT INTO atlas_objects SELECT scope_id,id,'representation' FROM atlas_representation_ids;
ALTER TABLE atlas_representation_ids ADD CONSTRAINT atlas_representation_identity_object FOREIGN KEY(scope_id,id) REFERENCES atlas_objects(scope_id,id);
ALTER TABLE atlas_representations ADD COLUMN id uuid;
ALTER TABLE atlas_representations ADD COLUMN feature_id uuid;
ALTER TABLE atlas_representations ADD COLUMN valid_from bigint;
ALTER TABLE atlas_representations ADD COLUMN valid_to bigint;
UPDATE atlas_representations r SET id=i.id,feature_id=f.id,valid_from=f.valid_from,valid_to=f.valid_to
    FROM atlas_features f,atlas_representation_ids i
    WHERE r.feature_revision=f.revision_id AND i.scope_id=r.scope_id AND i.feature_id=f.id AND i.area_id=r.area_id;
ALTER TABLE atlas_representations ALTER COLUMN id SET NOT NULL, ALTER COLUMN feature_id SET NOT NULL, ALTER COLUMN valid_from SET NOT NULL;
ALTER TABLE atlas_representations DROP CONSTRAINT atlas_representations_feature_revision_area_id_key;
ALTER TABLE atlas_representations ADD FOREIGN KEY(scope_id,id) REFERENCES atlas_representation_ids(scope_id,id);
ALTER TABLE atlas_representations ADD CHECK(valid_from>0 AND (valid_to IS NULL OR valid_to>valid_from));
ALTER TABLE atlas_representations ADD CONSTRAINT atlas_representation_revision_overlap EXCLUDE USING gist(scope_id WITH =,id WITH =,int8range(valid_from,valid_to,'[)') WITH &&);
CREATE UNIQUE INDEX atlas_representations_current ON atlas_representations(scope_id,id) WHERE valid_to IS NULL;
CREATE INDEX atlas_representations_feature ON atlas_representations(scope_id,feature_id,valid_from,valid_to);
CREATE INDEX atlas_representations_extent ON atlas_representations USING gist(scope_id,geometry);
