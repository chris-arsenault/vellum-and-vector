use super::PrivateInputs;
use crate::context_inventory::InputEntry;
use atlas_map::MapRef;
use std::io;

impl PrivateInputs {
    pub fn inventory(&self) -> io::Result<Vec<InputEntry>> {
        self.db.borrow_mut().query("SELECT c.id,c.document,i.map_id,i.map_revision FROM generation.catalogs c FULL JOIN generation.inputs i ON i.catalog_id=c.id", &[]).map_err(io::Error::other)?.iter().map(|r| {
            let id: Option<String> = r.try_get("map_id").map_err(io::Error::other)?;
            Ok(InputEntry {
                reference: id.map(|map_id| Ok::<_,io::Error>(MapRef { map_id, revision: r.try_get("map_revision").map_err(io::Error::other)? })).transpose()?,
                catalog: r.try_get::<_,Option<String>>("id").map_err(io::Error::other)?.unwrap_or_default(),
                document: r.try_get::<_,Option<serde_json::Value>>("document").map_err(io::Error::other)?.unwrap_or_default(),
            })
        }).collect()
    }
    pub fn delete_map(&self, id: &str) -> io::Result<()> {
        let mut db = self.db.borrow_mut();
        let mut tx = db.transaction().map_err(io::Error::other)?;
        let catalogs: Vec<String> = tx
            .query(
                "DELETE FROM generation.inputs WHERE map_id=$1 RETURNING catalog_id",
                &[&id],
            )
            .map_err(io::Error::other)?
            .iter()
            .map(|r| r.get(0))
            .collect();
        for catalog in catalogs {
            tx.execute("DELETE FROM generation.catalogs WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM generation.inputs WHERE catalog_id=$1)", &[&catalog]).map_err(io::Error::other)?;
        }
        tx.commit().map_err(io::Error::other)
    }
    pub fn delete_catalog(&self, id: &str) -> io::Result<()> {
        self.db.borrow_mut().execute("DELETE FROM generation.catalogs WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM generation.inputs WHERE catalog_id=$1)", &[&id]).map_err(io::Error::other)?;
        Ok(())
    }
    pub fn delete_revision(&self, reference: &MapRef) -> io::Result<()> {
        let mut db = self.db.borrow_mut();
        let mut tx = db.transaction().map_err(io::Error::other)?;
        let rows = tx.query("DELETE FROM generation.inputs WHERE map_id=$1 AND map_revision=$2 RETURNING catalog_id", &[&reference.map_id, &reference.revision]).map_err(io::Error::other)?;
        for row in rows {
            let catalog: String = row.get(0);
            tx.execute("DELETE FROM generation.catalogs WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM generation.inputs WHERE catalog_id=$1)", &[&catalog]).map_err(io::Error::other)?;
        }
        tx.commit().map_err(io::Error::other)
    }
    pub fn geography_ids(&self) -> io::Result<Vec<(String, String, String)>> {
        self.db
            .borrow_mut()
            .query("SELECT world_id,area_id,id FROM generation.geography", &[])
            .map_err(io::Error::other)?
            .iter()
            .map(|r| {
                Ok((
                    r.try_get(0).map_err(io::Error::other)?,
                    r.try_get(1).map_err(io::Error::other)?,
                    r.try_get(2).map_err(io::Error::other)?,
                ))
            })
            .collect()
    }
    pub fn remove_geography(&self, key: &(String, String, String)) -> io::Result<()> {
        self.db
            .borrow_mut()
            .execute(
                "DELETE FROM generation.geography WHERE world_id=$1 AND area_id=$2 AND id=$3",
                &[&key.0, &key.1, &key.2],
            )
            .map_err(io::Error::other)?;
        Ok(())
    }
}
