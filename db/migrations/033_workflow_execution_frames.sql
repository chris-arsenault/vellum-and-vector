ALTER TABLE atlas_workflow_feedback ADD COLUMN accumulator_process text, ADD COLUMN accumulator_version text;
ALTER TABLE atlas_workflow_feedback ADD FOREIGN KEY(accumulator_process,accumulator_version) REFERENCES atlas_process_versions(id,version);
ALTER TABLE atlas_workflow_feedback ADD CHECK ((accumulator_process IS NULL)=(accumulator_version IS NULL));
ALTER TABLE atlas_workflow_ports ADD COLUMN time_policy text NOT NULL DEFAULT 'scope' CHECK(time_policy IN ('scope','any'));
CREATE TABLE atlas_run_output_selection (
  run_id uuid PRIMARY KEY REFERENCES atlas_runs(id),
  random_algorithm text NOT NULL CHECK(random_algorithm='atlas-counter-v1')
);
CREATE TABLE atlas_run_output_ports (
  run_id uuid NOT NULL REFERENCES atlas_run_output_selection(run_id),ordinal integer NOT NULL,port text NOT NULL,
  PRIMARY KEY(run_id,ordinal),UNIQUE(run_id,port)
);
CREATE TRIGGER run_plan_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_run_output_selection FOR EACH ROW EXECUTE FUNCTION atlas_guard_run_plan_rows();
CREATE TRIGGER run_plan_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_run_output_ports FOR EACH ROW EXECUTE FUNCTION atlas_guard_run_plan_rows();

ALTER TABLE atlas_checkpoint_resources DROP CONSTRAINT atlas_checkpoint_resources_role_check;
ALTER TABLE atlas_checkpoint_resources ADD CHECK(role IN ('artifact','output','feedback','working','input','read','initial','result','workflowInput'));

CREATE TABLE atlas_checkpoint_frames (
  checkpoint_id uuid PRIMARY KEY REFERENCES atlas_run_checkpoints(id),
  world_id uuid NOT NULL,
  phase text NOT NULL CHECK(phase IN ('start','nodes','feedback','complete')),
  iteration_index bigint NOT NULL CHECK(iteration_index>=0),
  variables uuid NOT NULL,
  parameters uuid,
  invocation_path text[] NOT NULL,
  random_algorithm text NOT NULL CHECK(random_algorithm='atlas-counter-v1'),
  FOREIGN KEY(world_id,checkpoint_id) REFERENCES atlas_run_checkpoints(world_id,id),
  FOREIGN KEY(world_id,variables) REFERENCES atlas_value_sets(scope_id,id),
  FOREIGN KEY(world_id,parameters) REFERENCES atlas_value_sets(scope_id,id)
);
CREATE TABLE atlas_checkpoint_node_execution (
  checkpoint_id uuid NOT NULL, node_path text[] NOT NULL, world_id uuid NOT NULL,
  parameters uuid NOT NULL, application_order bigint CHECK(application_order>0),
  area_id uuid,space_id uuid,footprint geometry,crs_id text,source_version bigint,time_context text,resolution double precision,
  PRIMARY KEY(checkpoint_id,node_path),
  FOREIGN KEY(checkpoint_id,node_path) REFERENCES atlas_checkpoint_nodes(checkpoint_id,path),
  FOREIGN KEY(world_id,checkpoint_id) REFERENCES atlas_run_checkpoints(world_id,id),
  FOREIGN KEY(world_id,parameters) REFERENCES atlas_value_sets(scope_id,id),
  CHECK(application_order IS NULL OR (area_id IS NOT NULL AND space_id IS NOT NULL AND footprint IS NOT NULL AND crs_id IS NOT NULL AND source_version IS NOT NULL AND time_context IS NOT NULL)),
  CHECK(footprint IS NULL OR (ST_SRID(footprint)=0 AND ST_IsValid(footprint) AND NOT ST_IsEmpty(footprint)))
);
CREATE TABLE atlas_checkpoint_domain_bindings (
  checkpoint_id uuid NOT NULL,node_path text[] NOT NULL,ordinal integer NOT NULL,
  world_id uuid NOT NULL,resource_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('field','features','entities','network','history')),
  field_id uuid,layer_id text,
  PRIMARY KEY(checkpoint_id,node_path,ordinal),
  FOREIGN KEY(checkpoint_id,node_path) REFERENCES atlas_checkpoint_nodes(checkpoint_id,path),
  FOREIGN KEY(world_id,checkpoint_id) REFERENCES atlas_run_checkpoints(world_id,id),
  FOREIGN KEY(world_id,resource_id) REFERENCES atlas_resources(world_id,id),
  CHECK((kind='field' AND field_id IS NOT NULL AND layer_id IS NOT NULL) OR (kind<>'field' AND field_id IS NULL AND layer_id IS NULL))
);
CREATE TABLE atlas_checkpoint_domain_reads (
  checkpoint_id uuid NOT NULL,node_path text[] NOT NULL,world_id uuid NOT NULL,
  kind text NOT NULL,object_id text NOT NULL,revision_id uuid NOT NULL REFERENCES atlas_revision_owners(id),version bigint NOT NULL,
  PRIMARY KEY(checkpoint_id,node_path,kind,object_id),
  FOREIGN KEY(checkpoint_id,node_path) REFERENCES atlas_checkpoint_nodes(checkpoint_id,path),
  FOREIGN KEY(world_id,revision_id) REFERENCES atlas_revision_owners(scope_id,id),
  FOREIGN KEY(world_id,checkpoint_id) REFERENCES atlas_run_checkpoints(world_id,id)
);
CREATE TABLE atlas_checkpoint_fact_effects (
  checkpoint_id uuid NOT NULL,node_path text[] NOT NULL,ordinal integer NOT NULL,
  world_id uuid NOT NULL,fact text NOT NULL,area_id uuid NOT NULL,space_id uuid NOT NULL,
  footprint geometry NOT NULL,crs_id text NOT NULL,source_version bigint NOT NULL,time_context text NOT NULL,resolution double precision,
  PRIMARY KEY(checkpoint_id,node_path,ordinal),
  FOREIGN KEY(checkpoint_id,node_path) REFERENCES atlas_checkpoint_nodes(checkpoint_id,path),
  FOREIGN KEY(world_id,checkpoint_id) REFERENCES atlas_run_checkpoints(world_id,id),
  CHECK(ST_SRID(footprint)=0 AND ST_IsValid(footprint) AND NOT ST_IsEmpty(footprint))
);
CREATE TRIGGER checkpoint_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_checkpoint_frames FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_checkpoint_rows();
CREATE TRIGGER checkpoint_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_checkpoint_node_execution FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_checkpoint_rows();
CREATE TRIGGER checkpoint_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_checkpoint_domain_bindings FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_checkpoint_rows();
CREATE TRIGGER checkpoint_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_checkpoint_domain_reads FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_checkpoint_rows();
CREATE TRIGGER checkpoint_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_checkpoint_fact_effects FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_checkpoint_rows();
