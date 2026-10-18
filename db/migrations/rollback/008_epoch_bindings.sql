DO $$ BEGIN
    IF EXISTS(SELECT FROM atlas_workflow_epoch_bindings) THEN
        RAISE EXCEPTION 'State-bound epoch variables need an explicit downgrade transition';
    END IF;
END $$;
DROP TABLE atlas_workflow_epoch_bindings;
ALTER TABLE atlas_workflow_bindings DROP CONSTRAINT atlas_workflow_bindings_target_kind_check;
ALTER TABLE atlas_workflow_bindings ADD CHECK(target_kind IN ('input','parameter','output','condition','feedback_initial','feedback_next','until'));
