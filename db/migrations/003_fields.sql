CREATE TYPE atlas_field_boundary AS (footprint geometry, samples atlas_sample[], rings atlas_ring[]);
CREATE TYPE atlas_budget AS (epoch text, rain double precision, inflow double precision, evaporation double precision, outflow double precision,
    groundwater_change double precision, surface_storage_change double precision, ice_change double precision, sediment_produced double precision,
    sediment_deposited double precision, sediment_exported double precision, ice_import double precision, ice_export double precision,
    material_forcing double precision, sediment_storage_change double precision);
CREATE TYPE atlas_human_event AS (kind text, actor uuid, position atlas_position, amount double precision, causes uuid[]);
CREATE TABLE atlas_grids (
    id uuid PRIMARY KEY, world_id uuid NOT NULL REFERENCES atlas_worlds(id), bounds double precision[] NOT NULL,
    width integer NOT NULL CHECK(width>=2), height integer NOT NULL CHECK(height>=2), measures double precision[], has_water_bodies boolean NOT NULL,
    CHECK(array_length(bounds,1)=4 AND bounds[1]<bounds[3] AND bounds[2]<bounds[4]),
    CHECK(measures IS NULL OR cardinality(measures)=width*height)
);
CREATE TABLE atlas_grid_channels (
    grid_id uuid NOT NULL REFERENCES atlas_grids(id), name text NOT NULL, values double precision[] NOT NULL,
    PRIMARY KEY(grid_id,name)
);
CREATE FUNCTION atlas_check_channel_length() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF cardinality(NEW.values) <> (SELECT width*height FROM atlas_grids WHERE id=NEW.grid_id) THEN
        RAISE EXCEPTION 'Field channel must contain exactly width*height values';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER atlas_grid_channel_length BEFORE INSERT OR UPDATE ON atlas_grid_channels FOR EACH ROW EXECUTE FUNCTION atlas_check_channel_length();
CREATE TABLE atlas_grid_water_bodies (
    grid_id uuid NOT NULL REFERENCES atlas_grids(id), ordinal integer NOT NULL, id uuid NOT NULL, footprint geometry NOT NULL,
    volume double precision NOT NULL, spill double precision NOT NULL, outlet atlas_position, outlet_from atlas_position,
    suspended double precision NOT NULL, fixed_level double precision, outlet_path atlas_position[], PRIMARY KEY(grid_id,ordinal)
);
CREATE TABLE atlas_grid_lake_slices (
    grid_id uuid NOT NULL, body_ordinal integer NOT NULL, ordinal integer NOT NULL,
    floor double precision NOT NULL, area double precision NOT NULL, footprint geometry, sediment double precision NOT NULL,
    PRIMARY KEY(grid_id,body_ordinal,ordinal), FOREIGN KEY(grid_id,body_ordinal) REFERENCES atlas_grid_water_bodies(grid_id,ordinal)
);
CREATE TABLE atlas_fields (
    id uuid PRIMARY KEY, world_id uuid NOT NULL REFERENCES atlas_worlds(id), area_id uuid NOT NULL, grid_id uuid NOT NULL REFERENCES atlas_grids(id),
    algorithm text NOT NULL, seed integer NOT NULL, boundary atlas_field_boundary, initial_grid uuid REFERENCES atlas_grids(id),
    has_authored boolean NOT NULL, has_history boolean NOT NULL, has_budgets boolean NOT NULL,
    has_transfers boolean NOT NULL, has_links boolean NOT NULL, has_human_history boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(world_id,area_id) REFERENCES atlas_objects(scope_id,id)
);
CREATE INDEX atlas_fields_world ON atlas_fields(world_id);
CREATE TABLE atlas_field_protections (
    field_id uuid NOT NULL REFERENCES atlas_fields(id), ordinal integer NOT NULL, id uuid NOT NULL, footprint geometry NOT NULL,
    channels text[] NOT NULL, actor text NOT NULL, grid_id uuid REFERENCES atlas_grids(id), PRIMARY KEY(field_id,ordinal)
);
CREATE TABLE atlas_field_epochs (
    field_id uuid NOT NULL REFERENCES atlas_fields(id), ordinal integer NOT NULL, epoch atlas_epoch NOT NULL,
    grid_id uuid NOT NULL REFERENCES atlas_grids(id), forcing uuid[] NOT NULL, has_links boolean NOT NULL, PRIMARY KEY(field_id,ordinal)
);
CREATE TABLE atlas_field_links (
    field_id uuid NOT NULL REFERENCES atlas_fields(id), epoch_ordinal integer NOT NULL, ordinal integer NOT NULL,
    id uuid NOT NULL, a atlas_position NOT NULL, b atlas_position NOT NULL, rate double precision NOT NULL, channel boolean NOT NULL,
    PRIMARY KEY(field_id,epoch_ordinal,ordinal)
);
CREATE TABLE atlas_field_budgets (
    field_id uuid NOT NULL REFERENCES atlas_fields(id), ordinal integer NOT NULL, budget atlas_budget NOT NULL, PRIMARY KEY(field_id,ordinal)
);
CREATE TABLE atlas_field_transfers (
    field_id uuid NOT NULL REFERENCES atlas_fields(id), ordinal integer NOT NULL, feature_id uuid NOT NULL,
    point atlas_position NOT NULL, rate double precision NOT NULL, storage_id uuid NOT NULL, source_field_id uuid NOT NULL, PRIMARY KEY(field_id,ordinal)
);
CREATE TABLE atlas_field_human_epochs (
    field_id uuid NOT NULL REFERENCES atlas_fields(id), ordinal integer NOT NULL, era atlas_human_era NOT NULL,
    grid_id uuid NOT NULL REFERENCES atlas_grids(id), events atlas_human_event[] NOT NULL, PRIMARY KEY(field_id,ordinal)
);
ALTER TABLE atlas_field_references ADD FOREIGN KEY(id) REFERENCES atlas_fields(id) DEFERRABLE INITIALLY DEFERRED;
