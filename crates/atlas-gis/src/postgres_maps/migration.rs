mod legacy;
use super::{description::get, PostgresMaps};
use crate::postgres_migrations::{self, Migration, Schema};
use std::io;

const SCHEMA: &str = include_str!("schema.sql");

impl PostgresMaps {
    pub fn initialize(&self) -> io::Result<()> {
        postgres_migrations::run(
            &self.db,
            Schema::Map,
            &[Migration {
                version: 1,
                apply: &|| self.upgrade_map_rows(),
            }],
        )
    }

    fn upgrade_map_rows(&self) -> io::Result<()> {
        if self.has_map_column("revisions", "descriptor")? {
            return self.migrate_legacy_maps();
        }
        let packed_samples = self.has_map_column("samples", "data")?;
        if packed_samples {
            self.batch(
                "CREATE SCHEMA atlas_map_upgrade;
                 ALTER TABLE map.samples SET SCHEMA atlas_map_upgrade",
            )?;
        }
        let history_exists =
            self.query_one_bool("SELECT to_regclass('map.history') IS NOT NULL AS present")?;
        if history_exists && !self.has_map_column("history", "ordinal")? {
            self.batch(include_str!("migration/001_history_order.sql"))?;
        }
        self.batch(SCHEMA)?;
        if packed_samples {
            self.migrate_packed_samples()?;
            self.batch("DROP TABLE atlas_map_upgrade.samples; DROP SCHEMA atlas_map_upgrade")?;
        }
        self.batch(include_str!("migration/001_registry_columns.sql"))
    }

    fn query_one_bool(&self, sql: &str) -> io::Result<bool> {
        get(&self.query(sql, &[])?[0], "present")
    }

    fn has_map_column(&self, table: &str, column: &str) -> io::Result<bool> {
        get(
            &self.query(
                "SELECT EXISTS(SELECT FROM information_schema.columns
                 WHERE table_schema='map' AND table_name=$1 AND column_name=$2) AS present",
                &[&table, &column],
            )?[0],
            "present",
        )
    }
}
