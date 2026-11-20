//! Versioned upgrades for the generation schema, under its own database role.
use super::{uuid, PrivateInputs};
use crate::{generation_document, record_store::Retained};
use atlas_generation::features::{
    network::{Node, Reach},
    Feature,
};
use atlas_gis::{
    map_store::codec,
    postgres_migrations::{self, legacy_id, legacy_id_value, legacy_ids, Migration, Schema},
};
use postgres::{Client, Row};
use serde_json::Value;
use std::io;

const SCHEMA: &str = include_str!("../private_inputs.sql");

impl PrivateInputs {
    pub fn initialize(&self) -> io::Result<()> {
        postgres_migrations::run(
            &self.db,
            Schema::Generation,
            &[Migration {
                version: 1,
                apply: &|| migrate(&mut self.db.borrow_mut()),
            }],
        )
    }
}

fn migrate(db: &mut Client) -> io::Result<()> {
    let row = db
        .query_one(
            "SELECT EXISTS(SELECT FROM information_schema.columns
         WHERE table_schema='generation' AND
         ((table_name='inputs' AND column_name='map_id' AND data_type='text')
          OR (table_name='records' AND column_name='data' AND data_type='jsonb')))",
            &[],
        )
        .map_err(io::Error::other)?;
    if !field::<bool>(&row, 0)? {
        return db.batch_execute(SCHEMA).map_err(io::Error::other);
    }
    db.batch_execute(include_str!("migration/001_stage_legacy.sql"))
        .map_err(io::Error::other)?;
    db.batch_execute(SCHEMA).map_err(io::Error::other)?;
    copy_inputs(db).map_err(io::Error::other)?;
    upgrade_catalogues(db)?;
    copy_geography(db).map_err(io::Error::other)?;
    copy_records(db)?;
    db.batch_execute(include_str!("migration/001_finish_legacy.sql"))
        .map_err(io::Error::other)
}

fn copy_inputs(db: &mut Client) -> Result<(), postgres::Error> {
    for row in db.query(
        "SELECT map_id::text,map_revision::text,world_id::text,area_id::text,revision,catalog_id
         FROM atlas_generation_upgrade.inputs",
        &[],
    )? {
        db.execute(
            "INSERT INTO generation.inputs VALUES($1,$2,$3,$4,$5,$6)",
            &[
                &key(&row, 0)?,
                &key(&row, 1)?,
                &key(&row, 2)?,
                &key(&row, 3)?,
                &row.try_get::<_, i64>(4)?,
                &row.try_get::<_, &str>(5)?,
            ],
        )?;
    }
    Ok(())
}

fn key(row: &Row, column: usize) -> Result<uuid::Uuid, postgres::Error> {
    Ok(uuid(legacy_id(row.try_get(column)?)))
}

fn upgrade_catalogues(db: &mut Client) -> io::Result<()> {
    let rows = db
        .query("SELECT id,document FROM generation.catalogs", &[])
        .map_err(io::Error::other)?;
    for row in &rows {
        let id: &str = field(row, 0)?;
        let mut document: Value = field(row, 1)?;
        upgrade_document(&mut document);
        let _: generation_document::Document =
            generation_document::FORMAT.read(document.clone())?;
        db.execute(
            "UPDATE generation.catalogs SET document=$2 WHERE id=$1",
            &[&id, &document],
        )
        .map_err(io::Error::other)?;
    }
    Ok(())
}

fn upgrade_document(document: &mut Value) {
    located(&mut document["scope"]);
    let world = &mut document["world"];
    legacy_ids(world, &["id"]);
    for key in ["areas", "drainage"] {
        if let Some(entries) = world.get_mut(key).and_then(Value::as_object_mut) {
            *entries = std::mem::take(entries)
                .into_iter()
                .map(|(id, mut value)| {
                    legacy_ids(&mut value, &["id", "parentId", "spaceId"]);
                    (legacy_id(&id).to_string(), value)
                })
                .collect();
        }
    }
    for key in ["fields", "spaces", "epochs", "runs"] {
        let items = world.get_mut(key).and_then(Value::as_array_mut);
        for item in items.into_iter().flatten() {
            located(item);
            if let Some(scope) = item.get_mut("scope") {
                located(scope);
            }
            if key == "spaces" {
                legacy_ids(item, &["id", "parentSpaceId"]);
            }
        }
    }
}

fn located(value: &mut Value) {
    legacy_ids(value, &["worldId", "areaId", "spaceId", "crsId"]);
}

fn copy_geography(db: &mut Client) -> Result<(), postgres::Error> {
    let rows = db.query(
        "SELECT world_id::text,area_id::text,id,data FROM atlas_generation_upgrade.geography",
        &[],
    )?;
    for row in rows {
        let mut value: Value = row.try_get(3)?;
        if let Some(scope) = value.get_mut("scope") {
            located(scope);
        }
        db.execute(
            "INSERT INTO generation.geography VALUES($1,$2,$3,$4)",
            &[
                &key(&row, 0)?,
                &key(&row, 1)?,
                &row.try_get::<_, &str>(2)?,
                &value,
            ],
        )?;
    }
    Ok(())
}

fn copy_records(db: &mut Client) -> io::Result<()> {
    let mut after = (None::<String>, None::<String>, None::<String>);
    loop {
        let rows = db
            .query(
                "SELECT catalog_id,kind,id::text,data FROM atlas_generation_upgrade.records
             WHERE $1::text IS NULL OR (catalog_id,kind,id::text)>($1,$2,$3)
             ORDER BY catalog_id,kind,id::text LIMIT 512",
                &[&after.0, &after.1, &after.2],
            )
            .map_err(io::Error::other)?;
        let Some(last) = rows.last() else {
            return Ok(());
        };
        after = (field(last, 0)?, field(last, 1)?, field(last, 2)?);
        for row in &rows {
            copy_record(db, row)?;
        }
    }
}

fn copy_record(db: &mut Client, row: &Row) -> io::Result<()> {
    let kind: &str = field(row, 1)?;
    let value: Value = field(row, 3)?;
    let (kind, bytes) = convert_record(kind, value)?;
    let catalog: &str = field(row, 0)?;
    let id = key(row, 2).map_err(io::Error::other)?;
    db.execute(
        "INSERT INTO generation.records VALUES($1,$2,$3,$4)",
        &[&catalog, &(kind as i16), &id, &bytes],
    )
    .map_err(io::Error::other)?;
    Ok(())
}

fn field<'a, T: postgres::types::FromSql<'a>>(row: &'a Row, column: usize) -> io::Result<T> {
    row.try_get(column).map_err(io::Error::other)
}

fn convert_record(kind: &str, mut value: Value) -> io::Result<(Retained, Vec<u8>)> {
    legacy_ids(&mut value, &["id"]);
    match kind {
        "feature" => {
            feature(&mut value);
            Ok((
                Retained::Feature,
                codec::encode(&serde_json::from_value::<Feature>(value)?)?,
            ))
        }
        "node" => {
            legacy_ids(&mut value, &["spaceId"]);
            Ok((
                Retained::Node,
                codec::encode(&serde_json::from_value::<Node>(value)?)?,
            ))
        }
        "reach" => {
            legacy_ids(&mut value, &["featureId", "start", "end"]);
            Ok((
                Retained::Reach,
                codec::encode(&serde_json::from_value::<Reach>(value)?)?,
            ))
        }
        _ => Err(io::Error::other(format!(
            "Unknown retained record kind {kind}"
        ))),
    }
}

fn feature(value: &mut Value) {
    legacy_ids(value, &["areaId", "generationId", "placeId"]);
    if let Some(detail) = value.get_mut("detail").and_then(Value::as_object_mut) {
        *detail = std::mem::take(detail)
            .into_iter()
            .map(|(area, mut representation)| {
                legacy_ids(&mut representation, &["id", "generationId"]);
                (legacy_id(&area).to_string(), representation)
            })
            .collect();
    }
    for relation in value["relations"].as_array_mut().into_iter().flatten() {
        legacy_id_value(&mut relation["targetId"]);
    }
}
