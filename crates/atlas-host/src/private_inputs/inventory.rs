use super::{id, uuid, PrivateInputs};
use crate::context_inventory::{GeographyKey, InputEntry};
use atlas_map::{Id, MapRef};
use std::io;

impl PrivateInputs {
    pub fn inventory(&self) -> io::Result<Vec<InputEntry>> {
        self.db
            .borrow_mut()
            .query(
                "SELECT c.id,c.document,i.map_id,i.map_revision FROM generation.catalogs c FULL JOIN generation.inputs i ON i.catalog_id=c.id",
                &[],
            )
            .map_err(io::Error::other)?
            .iter()
            .map(|r| {
                let map: Option<uuid::Uuid> = r.try_get("map_id").map_err(io::Error::other)?;
                let revision: Option<uuid::Uuid> =
                    r.try_get("map_revision").map_err(io::Error::other)?;
                Ok(InputEntry {
                    reference: map.zip(revision).map(|(map_id, revision)| MapRef {
                        map_id: id(map_id),
                        revision: id(revision),
                    }),
                    catalog: r
                        .try_get::<_, Option<String>>("id")
                        .map_err(io::Error::other)?
                        .unwrap_or_default(),
                    document: r
                        .try_get::<_, Option<serde_json::Value>>("document")
                        .map_err(io::Error::other)?
                        .unwrap_or_default(),
                })
            })
            .collect()
    }
    pub fn delete_map(&self, map_id: Id) -> io::Result<()> {
        let mut db = self.db.borrow_mut();
        let mut tx = db.transaction().map_err(io::Error::other)?;
        let catalogs: Vec<String> = tx
            .query(
                "DELETE FROM generation.inputs WHERE map_id=$1 RETURNING catalog_id",
                &[&uuid(map_id)],
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
        let rows = tx
            .query(
                "DELETE FROM generation.inputs WHERE map_id=$1 AND map_revision=$2 RETURNING catalog_id",
                &[&uuid(reference.map_id), &uuid(reference.revision)],
            )
            .map_err(io::Error::other)?;
        for row in rows {
            let catalog: String = row.get(0);
            tx.execute("DELETE FROM generation.catalogs WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM generation.inputs WHERE catalog_id=$1)", &[&catalog]).map_err(io::Error::other)?;
        }
        tx.commit().map_err(io::Error::other)
    }
    pub fn geography_ids(&self) -> io::Result<Vec<GeographyKey>> {
        self.db
            .borrow_mut()
            .query("SELECT world_id,area_id,id FROM generation.geography", &[])
            .map_err(io::Error::other)?
            .iter()
            .map(|r| {
                Ok((
                    id(r.try_get(0).map_err(io::Error::other)?),
                    id(r.try_get(1).map_err(io::Error::other)?),
                    r.try_get(2).map_err(io::Error::other)?,
                ))
            })
            .collect()
    }
    pub fn remove_geography(&self, key: &GeographyKey) -> io::Result<()> {
        self.db
            .borrow_mut()
            .execute(
                "DELETE FROM generation.geography WHERE world_id=$1 AND area_id=$2 AND id=$3",
                &[&uuid(key.0), &uuid(key.1), &key.2],
            )
            .map_err(io::Error::other)?;
        Ok(())
    }
}
