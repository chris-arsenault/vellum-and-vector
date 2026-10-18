ALTER TABLE atlas_run_checkpoints ADD COLUMN workflow_scope uuid,ADD COLUMN workflow_id text,ADD COLUMN workflow_version bigint;
ALTER TABLE atlas_run_checkpoints DISABLE TRIGGER atlas_checkpoint_immutable;
UPDATE atlas_run_checkpoints c SET workflow_scope=r.workflow_scope,workflow_id=r.workflow_id,workflow_version=r.workflow_version FROM atlas_runs r WHERE r.id=c.run_id;
ALTER TABLE atlas_run_checkpoints ENABLE TRIGGER atlas_checkpoint_immutable;
ALTER TABLE atlas_run_checkpoints ALTER COLUMN workflow_scope SET NOT NULL,ALTER COLUMN workflow_id SET NOT NULL,ALTER COLUMN workflow_version SET NOT NULL;
ALTER TABLE atlas_run_checkpoints ADD FOREIGN KEY(workflow_scope,workflow_id,workflow_version) REFERENCES atlas_workflow_versions(scope_id,id,version);
ALTER TABLE atlas_checkpoint_nodes ADD COLUMN ordinal integer NOT NULL DEFAULT 0,ADD COLUMN has_output boolean NOT NULL DEFAULT false;
ALTER TABLE atlas_checkpoint_iterations ADD COLUMN workflow_id text,ADD COLUMN workflow_version bigint;
ALTER TABLE atlas_checkpoint_iterations DISABLE TRIGGER checkpoint_sealed;
UPDATE atlas_checkpoint_iterations i SET workflow_id=c.workflow_id,workflow_version=c.workflow_version FROM atlas_run_checkpoints c WHERE c.id=i.checkpoint_id;
ALTER TABLE atlas_checkpoint_iterations ENABLE TRIGGER checkpoint_sealed;
ALTER TABLE atlas_checkpoint_iterations ALTER COLUMN workflow_id SET NOT NULL,ALTER COLUMN workflow_version SET NOT NULL;
ALTER TABLE atlas_checkpoint_iterations ADD FOREIGN KEY(world_id,workflow_id,workflow_version) REFERENCES atlas_workflow_versions(scope_id,id,version);
CREATE TABLE atlas_checkpoint_diagnostics (
    checkpoint_id uuid NOT NULL,node_path text[] NOT NULL,ordinal integer NOT NULL,code text NOT NULL,message text NOT NULL,
    severity text NOT NULL CHECK(severity IN ('warning','error')),invocation text,resource_id text,
    PRIMARY KEY(checkpoint_id,node_path,ordinal),FOREIGN KEY(checkpoint_id,node_path) REFERENCES atlas_checkpoint_nodes(checkpoint_id,path)
);
CREATE TRIGGER checkpoint_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_checkpoint_diagnostics
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_checkpoint_rows();
