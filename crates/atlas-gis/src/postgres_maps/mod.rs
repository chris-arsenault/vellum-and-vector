//! PostgreSQL/PostGIS finished-map storage. Private generation inputs use a separate capability.
// Arconis: docs/architecture/subsystems.arconis#item=postgis — LAN backend map store beside the native generator.
mod access;
mod inventory;
mod library;
mod publication;
mod queries;
mod records;
mod registry;
mod registry_query;
mod settlements;
use crate::native_map_geometry::NativeMapGeometry;
use atlas_map::{MapDescriptor, MapRef};
use postgres::{types::ToSql, Client, NoTls, Row};
use std::{cell::RefCell, io};

pub struct PostgresMaps {
    db: RefCell<Client>,
    geometry: NativeMapGeometry,
}
impl PostgresMaps {
    pub fn connect(url: &str) -> io::Result<Self> {
        Ok(Self {
            db: RefCell::new(Client::connect(url, NoTls).map_err(io::Error::other)?),
            geometry: NativeMapGeometry,
        })
    }
    pub fn initialize(&self) -> io::Result<()> {
        self.batch(include_str!("schema.sql"))
    }
    pub fn grant_reader(&self, role: &str) -> io::Result<()> {
        let role = format!("\"{}\"", role.replace('"', "\"\""));
        self.batch(&format!("GRANT USAGE ON SCHEMA map TO {role}; GRANT SELECT ON ALL TABLES IN SCHEMA map TO {role}; ALTER DEFAULT PRIVILEGES IN SCHEMA map GRANT SELECT ON TABLES TO {role}; REVOKE ALL ON SCHEMA generation FROM {role};"))
    }
    pub fn open(&self, reference: &MapRef) -> io::Result<MapDescriptor> {
        let row = self
            .query(
                "SELECT descriptor FROM map.revisions WHERE map_id=$1 AND revision=$2",
                &[&reference.map_id, &reference.revision],
            )?
            .into_iter()
            .next()
            .ok_or_else(|| io::Error::other("Map revision was not found"))?;
        crate::stored::read_map(row.try_get("descriptor").map_err(io::Error::other)?)
    }
    pub fn find_head(&self, id: &str) -> io::Result<Option<MapRef>> {
        self.query("SELECT revision FROM map.heads WHERE map_id=$1", &[&id])?
            .into_iter()
            .next()
            .map(|r| {
                Ok(MapRef {
                    map_id: id.into(),
                    revision: r.try_get("revision").map_err(io::Error::other)?,
                })
            })
            .transpose()
    }
    fn query(&self, sql: &str, params: &[&(dyn ToSql + Sync)]) -> io::Result<Vec<Row>> {
        self.db
            .borrow_mut()
            .query(sql, params)
            .map_err(database_error)
    }
    fn execute(&self, sql: &str, params: &[&(dyn ToSql + Sync)]) -> io::Result<u64> {
        self.db
            .borrow_mut()
            .execute(sql, params)
            .map_err(database_error)
    }
    fn batch(&self, sql: &str) -> io::Result<()> {
        self.db
            .borrow_mut()
            .batch_execute(sql)
            .map_err(database_error)
    }
    fn transaction<T>(&self, action: impl FnOnce() -> io::Result<T>) -> io::Result<T> {
        self.batch("BEGIN")?;
        match action().and_then(|value| self.batch("COMMIT").map(|()| value)) {
            Ok(value) => Ok(value),
            Err(error) => {
                self.batch("ROLLBACK").map_err(|rollback| {
                    io::Error::other(format!("{error}; rollback failed: {rollback}"))
                })?;
                Err(error)
            }
        }
    }
    fn lock(&self, id: &str) -> io::Result<()> {
        self.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            &[&id],
        )?;
        Ok(())
    }
}
fn database_error(error: postgres::Error) -> io::Error {
    match error.as_db_error() {
        Some(detail) => io::Error::other(format!("{}: {}", detail.code().code(), detail.message())),
        None => io::Error::other(error),
    }
}
fn to_json(value: &impl serde::Serialize) -> io::Result<serde_json::Value> {
    serde_json::to_value(value).map_err(io::Error::other)
}
fn from_json<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> io::Result<T> {
    serde_json::from_value(value).map_err(io::Error::other)
}
#[derive(Default)]
pub(super) struct Params(Vec<Box<dyn ToSql + Sync>>);
impl Params {
    fn bind(&mut self, value: impl ToSql + Sync + 'static) -> String {
        self.0.push(Box::new(value));
        format!("${}", self.0.len())
    }
    fn values(&self) -> Vec<&(dyn ToSql + Sync)> {
        self.0.iter().map(|v| v.as_ref()).collect()
    }
}
