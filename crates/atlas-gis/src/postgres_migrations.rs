//! Schema versioning for the native storage owners.
use atlas_map::Id;
use postgres::Client;
use serde_json::Value;
use std::{cell::RefCell, io};

#[derive(Clone, Copy)]
pub enum Schema {
    Map,
    Generation,
}

impl Schema {
    fn location(self) -> (&'static str, i32) {
        match self {
            Self::Map => ("map", 1),
            Self::Generation => ("generation", 2),
        }
    }
}

pub struct Migration<'a> {
    pub version: i32,
    pub apply: &'a dyn Fn() -> io::Result<()>,
}

/// A schema's startup lock, changes and journal are held in one transaction.
pub fn run(db: &RefCell<Client>, schema: Schema, migrations: &[Migration<'_>]) -> io::Result<()> {
    if !migrations
        .iter()
        .map(|m| m.version)
        .eq((1..).take(migrations.len()))
    {
        return Err(io::Error::other(
            "Migrations must be in consecutive version order",
        ));
    }
    db.borrow_mut()
        .batch_execute("BEGIN ISOLATION LEVEL READ COMMITTED")
        .map_err(database_error)?;
    match apply_pending(db, schema, migrations).and_then(|()| {
        db.borrow_mut()
            .batch_execute("COMMIT")
            .map_err(database_error)
    }) {
        Ok(()) => Ok(()),
        Err(error) => {
            db.borrow_mut()
                .batch_execute("ROLLBACK")
                .map_err(|rollback| {
                    io::Error::other(format!(
                        "{error}; rollback failed: {}",
                        database_error(rollback)
                    ))
                })?;
            Err(error)
        }
    }
}

fn apply_pending(
    db: &RefCell<Client>,
    schema: Schema,
    migrations: &[Migration<'_>],
) -> io::Result<()> {
    let (schema, lock) = schema.location();
    let table = format!("{schema}.schema_migrations");
    let applied = {
        let mut db = db.borrow_mut();
        db.query_one("SELECT pg_advisory_xact_lock(54116, $1)", &[&lock])
            .map_err(database_error)?;
        db.batch_execute(&format!(
            "CREATE SCHEMA IF NOT EXISTS {schema};
             CREATE TABLE IF NOT EXISTS {table} (version integer PRIMARY KEY)"
        ))
        .map_err(database_error)?;
        db.query(
            &format!("SELECT version FROM {table} ORDER BY version"),
            &[],
        )
        .map_err(database_error)?
        .into_iter()
        .map(|row| row.try_get::<_, i32>(0).map_err(database_error))
        .collect::<io::Result<Vec<_>>>()?
    };
    let version = i32::try_from(applied.len()).map_err(io::Error::other)?;
    if applied.len() > migrations.len() || !applied.into_iter().eq(1..=version) {
        return Err(io::Error::other(format!(
            "Unsupported {schema} schema migration history"
        )));
    }
    for migration in migrations.iter().filter(|m| m.version > version) {
        (migration.apply)().map_err(|error| {
            io::Error::other(format!(
                "{schema} schema migration {}: {error}",
                migration.version
            ))
        })?;
        db.borrow_mut()
            .execute(
                &format!("INSERT INTO {table} VALUES ($1)"),
                &[&migration.version],
            )
            .map_err(database_error)?;
    }
    Ok(())
}

/// Preserve UUIDs and give legacy names the same identity in both database schemas.
pub fn legacy_id(value: &str) -> Id {
    value.parse().unwrap_or_else(|_| Id::from_name(value))
}

pub fn legacy_ids(value: &mut Value, keys: &[&str]) {
    for key in keys {
        if let Some(field) = value.get_mut(key) {
            legacy_id_value(field);
        }
    }
}

pub fn legacy_id_value(value: &mut Value) {
    if let Some(name) = value.as_str() {
        *value = legacy_id(name).into();
    }
}

pub(crate) fn database_error(error: postgres::Error) -> io::Error {
    match error.as_db_error() {
        Some(detail) => io::Error::other(format!("{}: {}", detail.code().code(), detail.message())),
        None => io::Error::other(error),
    }
}
