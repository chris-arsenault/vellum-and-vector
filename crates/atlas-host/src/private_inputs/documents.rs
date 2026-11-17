//! Immutable completed metadata and records in the private PostgreSQL schema.
use super::{CompletedInputs, PrivateInputs};
use crate::{generation_document::Document, numerical_resource::Scope};
use atlas_generation::features::{
    network::{NetworkReader, NetworkWorkspace, Selection},
    FeatureReader, FeatureSelection, FeatureWorkspace,
};
use atlas_map::MapRef;
use serde_json::Value;
use std::io;

impl PrivateInputs {
    pub fn store(
        &self,
        reference: &MapRef,
        document: &Document,
        features: &dyn FeatureReader,
        networks: &dyn NetworkReader,
        geography: &[Value],
    ) -> io::Result<CompletedInputs> {
        let scope = &document.scope.located;
        if reference.map_id != scope.area_id
            || document
                .world
                .get("publication")
                .is_some_and(|v| !v.is_null())
        {
            return Err(io::Error::other(
                "Retain completed inputs for their own map",
            ));
        }
        if self
            .db
            .borrow_mut()
            .query_opt(
                "SELECT 1 FROM generation.inputs WHERE map_id=$1 AND map_revision=$2",
                &[&reference.map_id, &reference.revision],
            )
            .map_err(io::Error::other)?
            .is_some()
        {
            return self.read(reference);
        }
        let input = CompletedInputs {
            reference: reference.clone(),
            world_id: scope.world_id.clone(),
            area_id: scope.area_id.clone(),
            revision: document.world["version"]
                .as_u64()
                .ok_or_else(|| io::Error::other("Completed document needs its revision"))?,
            catalog_id: uuid::Uuid::new_v4().to_string(),
        };
        let mut db = self.db.borrow_mut();
        let mut transaction = db.transaction().map_err(io::Error::other)?;
        transaction
            .execute(
                "INSERT INTO generation.catalogs VALUES($1,$2)",
                &[
                    &input.catalog_id,
                    &crate::generation_document::FORMAT.write(document)?,
                ],
            )
            .map_err(io::Error::other)?;
        records(
            &mut transaction,
            &input.catalog_id,
            "feature",
            features.values(FeatureSelection::default())?,
            |feature| &feature.id,
        )?;
        records(
            &mut transaction,
            &input.catalog_id,
            "node",
            networks.nodes()?,
            |node| &node.id,
        )?;
        records(
            &mut transaction,
            &input.catalog_id,
            "reach",
            networks.reaches(Selection::default())?,
            |reach| &reach.id,
        )?;
        for value in geography {
            let scope: Scope = serde_json::from_value(value["scope"].clone())?;
            let id = value["id"]
                .as_str()
                .ok_or_else(|| io::Error::other("Field geography has an identity"))?;
            transaction
                .execute(
                    "INSERT INTO generation.geography VALUES($1,$2,$3,$4)",
                    &[&scope.world_id, &scope.area_id, &id, value],
                )
                .map_err(io::Error::other)?;
        }
        transaction
            .execute(
                "INSERT INTO generation.inputs VALUES($1,$2,$3,$4,$5,$6)",
                &[
                    &reference.map_id,
                    &reference.revision,
                    &input.world_id,
                    &input.area_id,
                    &i64::try_from(input.revision).map_err(io::Error::other)?,
                    &input.catalog_id,
                ],
            )
            .map_err(io::Error::other)?;
        transaction.commit().map_err(io::Error::other)?;
        Ok(input)
    }
    pub fn document(&self, reference: &MapRef) -> io::Result<Document> {
        let input = self.read(reference)?;
        let row = self
            .db
            .borrow_mut()
            .query_opt(
                "SELECT document FROM generation.catalogs WHERE id=$1",
                &[&input.catalog_id],
            )
            .map_err(io::Error::other)?
            .ok_or_else(|| io::Error::other("Completed generation document is missing"))?;
        crate::generation_document::FORMAT.read(row.try_get("document").map_err(io::Error::other)?)
    }
    pub fn load_records(
        &self,
        reference: &MapRef,
        features: &mut dyn FeatureWorkspace,
        networks: &mut dyn NetworkWorkspace,
    ) -> io::Result<()> {
        let input = self.read(reference)?;
        for kind in ["feature", "node", "reach"] {
            let mut after = String::new();
            loop {
                let rows = self.db.borrow_mut().query("SELECT id,data FROM generation.records WHERE catalog_id=$1 AND kind=$2 AND id>$3 ORDER BY id LIMIT 128", &[&input.catalog_id, &kind, &after]).map_err(io::Error::other)?;
                if rows.is_empty() {
                    break;
                }
                for row in rows {
                    after = row.try_get("id").map_err(io::Error::other)?;
                    let value: Value = row.try_get("data").map_err(io::Error::other)?;
                    match kind {
                        "feature" => features.put(serde_json::from_value(value)?)?,
                        "node" => networks.put_node(serde_json::from_value(value)?)?,
                        _ => networks.put_reach(serde_json::from_value(value)?)?,
                    }
                }
            }
        }
        Ok(())
    }
    pub fn geography(&self, scope: &Scope, id: &str) -> io::Result<Value> {
        self.db
            .borrow_mut()
            .query_opt(
                "SELECT data FROM generation.geography WHERE world_id=$1 AND area_id=$2 AND id=$3",
                &[&scope.world_id, &scope.area_id, &id],
            )
            .map_err(io::Error::other)?
            .ok_or_else(|| io::Error::other("Completed field geography is missing"))?
            .try_get("data")
            .map_err(io::Error::other)
    }
}
fn records<T: serde::Serialize>(
    transaction: &mut postgres::Transaction<'_>,
    catalog: &str,
    kind: &str,
    records: impl Iterator<Item = io::Result<T>>,
    identity: impl Fn(&T) -> &str,
) -> io::Result<()> {
    let mut records = records.peekable();
    while records.peek().is_some() {
        let mut batch = Vec::with_capacity(128);
        for record in records.by_ref().take(128) {
            let record = record?;
            batch.push(serde_json::json!({"id": identity(&record), "data": serde_json::to_value(&record)?}));
        }
        transaction.execute(
            "INSERT INTO generation.records(catalog_id,kind,id,data) SELECT $1,$2,id,data FROM jsonb_to_recordset($3) AS records(id text,data jsonb)",
            &[&catalog, &kind, &Value::Array(batch)],
        ).map_err(io::Error::other)?;
    }
    Ok(())
}
