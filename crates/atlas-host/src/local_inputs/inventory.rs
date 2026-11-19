use super::LocalInputs;
use crate::context_inventory::{GeographyKey, InputEntry};
use atlas_gis::sql::{self, column};
use atlas_map::{Id, MapRef};
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
                let reference = MapRef {
                    map_id: column(row, "map_id")?.id()?,
                    revision: column(row, "revision")?.id()?,
                };
                Ok(InputEntry {
                    catalog: format!("{}:{}", reference.map_id, reference.revision),
                    reference: Some(reference),
                    document: serde_json::from_str(column(row, "document")?.text()?)
                        .unwrap_or(serde_json::Value::Null),
                })
            })
            .collect()
    }
    pub fn delete_map(&self, id: Id) -> io::Result<()> {
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
    pub fn geography_ids(&self) -> io::Result<Vec<GeographyKey>> {
        self.db
            .query("SELECT world_id,area_id,id FROM generation_geography", &[])?
            .iter()
            .map(|r| {
                Ok((
                    column(r, "world_id")?.id()?,
                    column(r, "area_id")?.id()?,
                    column(r, "id")?.text()?.into(),
                ))
            })
            .collect()
    }
    pub fn remove_geography(&self, key: &GeographyKey) -> io::Result<()> {
        self.db.execute(
            "DELETE FROM generation_geography WHERE world_id=? AND area_id=? AND id=?",
            &[key.0.into(), key.1.into(), key.2.as_str().into()],
        )?;
        Ok(())
    }
}
