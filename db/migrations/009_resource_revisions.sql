ALTER TABLE atlas_resources ADD COLUMN published_version bigint;
ALTER TABLE atlas_resources ADD COLUMN retired_version bigint;
ALTER TABLE atlas_resources ADD FOREIGN KEY(world_id,published_version) REFERENCES atlas_world_versions(world_id,version);
ALTER TABLE atlas_resources ADD FOREIGN KEY(world_id,retired_version) REFERENCES atlas_world_versions(world_id,version);
ALTER TABLE atlas_resources ADD CHECK(retired_version IS NULL OR (published_version IS NOT NULL AND retired_version>published_version));
ALTER TABLE atlas_resources ADD CHECK((status='published')=(published_version IS NOT NULL));
CREATE INDEX atlas_resource_validity ON atlas_resources(world_id,published_version,retired_version);
ALTER TABLE atlas_invalidations ADD COLUMN time_context text NOT NULL DEFAULT 'present';
ALTER TABLE atlas_invalidations ADD COLUMN resolution double precision;
