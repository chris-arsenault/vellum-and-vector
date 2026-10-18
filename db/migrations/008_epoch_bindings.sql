ALTER TABLE atlas_workflow_bindings DROP CONSTRAINT atlas_workflow_bindings_target_kind_check;
ALTER TABLE atlas_workflow_bindings ADD CHECK(target_kind IN ('input','parameter','output','condition','feedback_initial','feedback_next','until','epoch_variable'));
CREATE TABLE atlas_workflow_epoch_bindings (
    scope_id uuid NOT NULL, workflow_id text NOT NULL, workflow_version bigint NOT NULL,
    epoch_id text NOT NULL, variable text NOT NULL, binding_id uuid NOT NULL,
    PRIMARY KEY(scope_id,workflow_id,workflow_version,epoch_id,variable),
    FOREIGN KEY(scope_id,workflow_id,workflow_version,epoch_id) REFERENCES atlas_workflow_epochs(scope_id,workflow_id,workflow_version,id),
    FOREIGN KEY(scope_id,workflow_id,workflow_version,binding_id) REFERENCES atlas_workflow_bindings(scope_id,workflow_id,workflow_version,id)
);
CREATE TRIGGER workflow_sealed BEFORE INSERT OR UPDATE OR DELETE ON atlas_workflow_epoch_bindings
    FOR EACH ROW EXECUTE FUNCTION atlas_guard_sealed_workflow();
