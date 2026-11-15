use super::LocalInputs;
use crate::context_inventory::InputEntry;
use atlas_gis::sql::{self, column};
use atlas_map::MapRef;
use std::io;

impl LocalInputs {
    pub fn inventory(&self) -> io::Result<Vec<InputEntry>> {
        self.db
            .query(
                "SELECT map_id,revision,document FROM generation_catalogs",
                &[],
            )?
            .iter()
            .map(|row| {
                Ok(InputEntry {
                    reference: Some(MapRef {
                        map_id: column(row, "map_id")?.text()?.into(),
                        revision: column(row, "revision")?.text()?.into(),
                    }),
                    catalog: format!(
                        "{}:{}",
                        column(row, "map_id")?.text()?,
                        column(row, "revision")?.text()?
                    ),
                    document: serde_json::from_str(column(row, "document")?.text()?)
                        .unwrap_or(serde_json::Value::Null),
                })
            })
            .collect()
    }
    pub fn delete_map(&self, id: &str) -> io::Result<()> {
        sql::transaction(self.db.as_ref(), || {
            self.db.execute(
                "DELETE FROM generation_records WHERE map_id=?",
                &[id.into()],
            )?;
            self.db.execute(
                "DELETE FROM generation_catalogs WHERE map_id=?",
                &[id.into()],
            )?;
            Ok(())
        })
    }
    pub fn geography_ids(&self) -> io::Result<Vec<(String, String, String)>> {
        self.db
            .query("SELECT world_id,area_id,id FROM generation_geography", &[])?
            .iter()
            .map(|r| {
                Ok((
                    column(r, "world_id")?.text()?.into(),
                    column(r, "area_id")?.text()?.into(),
                    column(r, "id")?.text()?.into(),
                ))
            })
            .collect()
    }
    pub fn remove_geography(&self, key: &(String, String, String)) -> io::Result<()> {
        self.db.execute(
            "DELETE FROM generation_geography WHERE world_id=? AND area_id=? AND id=?",
            &[
                key.0.as_str().into(),
                key.1.as_str().into(),
                key.2.as_str().into(),
            ],
        )?;
        Ok(())
    }
}
