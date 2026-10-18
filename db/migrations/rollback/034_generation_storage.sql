DO $$ BEGIN
    RAISE EXCEPTION 'Generation storage replacement is forward-only; restore the pre-migration database backup to restore the retired prototype execution schema';
END $$;
