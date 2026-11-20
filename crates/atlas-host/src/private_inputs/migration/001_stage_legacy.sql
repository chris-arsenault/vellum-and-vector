CREATE SCHEMA atlas_generation_upgrade;
ALTER TABLE generation.inputs SET SCHEMA atlas_generation_upgrade;
ALTER TABLE generation.records SET SCHEMA atlas_generation_upgrade;
ALTER TABLE generation.geography SET SCHEMA atlas_generation_upgrade;
