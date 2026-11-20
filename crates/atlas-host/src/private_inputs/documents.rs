//! Immutable completed metadata and records in the private PostgreSQL schema.
use super::{uuid, CompletedInputs, PrivateInputs};
use crate::{generation_document::Document, numerical_resource::Scope, record_store::Retained};
use atlas_generation::features::{
    network::{NetworkReader, NetworkWorkspace, Selection},
    FeatureReader, FeatureSelection, FeatureWorkspace,
};
use atlas_gis::map_store::codec;
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
                &[&uuid(reference.map_id), &uuid(reference.revision)],
            )
            .map_err(io::Error::other)?
            .is_some()
        {
            return self.read(reference);
        }
        let input = CompletedInputs {
            reference: reference.clone(),
            world_id: scope.world_id,
            area_id: scope.area_id,
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
            Retained::Feature,
            features.values(FeatureSelection::default())?,
            |feature| feature.id,
        )?;
        records(
            &mut transaction,
            &input.catalog_id,
            Retained::Node,
            networks.nodes()?,
            |node| node.id,
        )?;
        records(
            &mut transaction,
            &input.catalog_id,
            Retained::Reach,
            networks.reaches(Selection::default())?,
            |reach| reach.id,
        )?;
        for value in geography {
            let scope: Scope = serde_json::from_value(value["scope"].clone())?;
            let id = value["id"]
                .as_str()
                .ok_or_else(|| io::Error::other("Field geography has an identity"))?;
            transaction
                .execute(
                    "INSERT INTO generation.geography VALUES($1,$2,$3,$4)",
                    &[&uuid(scope.world_id), &uuid(scope.area_id), &id, value],
                )
                .map_err(io::Error::other)?;
        }
        transaction
            .execute(
                "INSERT INTO generation.inputs VALUES($1,$2,$3,$4,$5,$6)",
                &[
                    &uuid(reference.map_id),
                    &uuid(reference.revision),
                    &uuid(input.world_id),
                    &uuid(input.area_id),
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
        for kind in [Retained::Feature, Retained::Node, Retained::Reach] {
            let mut after = uuid::Uuid::nil();
            loop {
                let rows = self
                    .db
                    .borrow_mut()
                    .query(
                        "SELECT id,data FROM generation.records WHERE catalog_id=$1 AND kind=$2
                         AND id>$3 ORDER BY id LIMIT 128",
                        &[&input.catalog_id, &(kind as i16), &after],
                    )
                    .map_err(io::Error::other)?;
                if rows.is_empty() {
                    break;
                }
                for row in rows {
                    after = row.try_get("id").map_err(io::Error::other)?;
                    let data: &[u8] = row.try_get("data").map_err(io::Error::other)?;
                    match kind {
                        Retained::Feature => features.put(codec::decode(data)?)?,
                        Retained::Node => networks.put_node(codec::decode(data)?)?,
                        Retained::Reach => networks.put_reach(codec::decode(data)?)?,
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
                &[&uuid(scope.world_id), &uuid(scope.area_id), &id],
            )
            .map_err(io::Error::other)?
            .ok_or_else(|| io::Error::other("Completed field geography is missing"))?
            .try_get("data")
            .map_err(io::Error::other)
    }
}
/// Records streamed as binary rows: identity, kind code and the record as CBOR.
fn records<T: serde::Serialize>(
    transaction: &mut postgres::Transaction<'_>,
    catalog: &str,
    kind: Retained,
    records: impl Iterator<Item = io::Result<T>>,
    identity: impl Fn(&T) -> atlas_map::Id,
) -> io::Result<()> {
    use postgres::{
        binary_copy::BinaryCopyInWriter,
        types::{ToSql, Type},
    };
    let sink = transaction
        .copy_in("COPY generation.records(catalog_id,kind,id,data) FROM STDIN BINARY")
        .map_err(io::Error::other)?;
    let mut writer =
        BinaryCopyInWriter::new(sink, &[Type::TEXT, Type::INT2, Type::UUID, Type::BYTEA]);
    let code = kind as i16;
    for record in records {
        let record = record?;
        let id = uuid(identity(&record));
        let data = codec::encode(&record)?;
        let row: [&(dyn ToSql + Sync); 4] = [&catalog, &code, &id, &data];
        writer.write(&row).map_err(io::Error::other)?;
    }
    writer.finish().map_err(io::Error::other)?;
    Ok(())
}
