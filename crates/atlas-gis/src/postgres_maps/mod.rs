//! PostgreSQL/PostGIS finished-map storage. Private generation inputs use a separate capability.
// Arconis: docs/architecture/subsystems.arconis#item=postgis — LAN backend map store beside the native generator.
mod access;
mod description;
mod edits;
mod features;
mod inventory;
mod library;
mod migration;
mod publication;
mod queries;
mod records;
mod registry;
mod registry_query;
mod settlements;
use crate::native_map_geometry::NativeMapGeometry;
use crate::postgres_migrations::database_error;
use atlas_map::{Id, MapDescriptor, MapRef};
use postgres::{types::ToSql, Client, NoTls, Row};
use std::{cell::RefCell, io};

pub struct PostgresMaps {
    db: RefCell<Client>,
    geometry: NativeMapGeometry,
    /// The publication this connection is writing, held between appends.
    open: RefCell<Option<records::Open>>,
    geometry_type: RefCell<Option<postgres::types::Type>>,
}
impl PostgresMaps {
    pub fn connect(url: &str) -> io::Result<Self> {
        Ok(Self {
            db: RefCell::new(Client::connect(url, NoTls).map_err(io::Error::other)?),
            geometry: NativeMapGeometry,
            open: RefCell::new(None),
            geometry_type: RefCell::new(None),
        })
    }
    pub fn grant_reader(&self, role: &str) -> io::Result<()> {
        let role = format!("\"{}\"", role.replace('"', "\"\""));
        self.batch(&format!("GRANT USAGE ON SCHEMA map TO {role}; GRANT SELECT ON ALL TABLES IN SCHEMA map TO {role}; ALTER DEFAULT PRIVILEGES IN SCHEMA map GRANT SELECT ON TABLES TO {role}; REVOKE ALL ON SCHEMA generation FROM {role};"))
    }
    pub fn open(&self, reference: &MapRef) -> io::Result<MapDescriptor> {
        self.read_description(reference).map(|(map, _)| map)
    }
    pub fn find_head(&self, map_id: Id) -> io::Result<Option<MapRef>> {
        self.query(
            "SELECT revision FROM map.heads WHERE map_id=$1",
            &[&uuid(map_id)],
        )?
        .into_iter()
        .next()
        .map(|r| {
            Ok(MapRef {
                map_id,
                revision: id(r.try_get("revision").map_err(io::Error::other)?),
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
    /// Serialises writers of one map: the lock key is the map identity's leading 64 bits.
    fn lock(&self, map_id: Id) -> io::Result<()> {
        let bytes = map_id.to_bytes();
        let key = i64::from_be_bytes(bytes[..8].try_into().expect("eight bytes"));
        self.query("SELECT pg_advisory_xact_lock($1)", &[&key])?;
        Ok(())
    }
}
fn to_json(value: &impl serde::Serialize) -> io::Result<serde_json::Value> {
    serde_json::to_value(value).map_err(io::Error::other)
}
/// An identity as PostgreSQL's `uuid`.
pub(super) fn uuid(id: atlas_map::Id) -> uuid::Uuid {
    uuid::Uuid::from_bytes(id.to_bytes())
}
pub(super) fn id(value: uuid::Uuid) -> atlas_map::Id {
    atlas_map::Id::from_bytes(value.into_bytes())
}
pub(super) fn uuids(ids: &[atlas_map::Id]) -> Vec<uuid::Uuid> {
    ids.iter().copied().map(uuid).collect()
}
/// A shape's WKB, written straight into a PostGIS `geometry` column: SRID 0 WKB is valid
/// extended WKB, which is what the column's binary input reads.
#[derive(Debug)]
pub(super) struct Wkb(pub Vec<u8>);
impl ToSql for Wkb {
    fn to_sql(
        &self,
        _: &postgres::types::Type,
        out: &mut bytes::BytesMut,
    ) -> Result<postgres::types::IsNull, Box<dyn std::error::Error + Sync + Send>> {
        out.extend_from_slice(&self.0);
        Ok(postgres::types::IsNull::No)
    }
    fn accepts(ty: &postgres::types::Type) -> bool {
        ty.name() == "geometry"
    }
    postgres::types::to_sql_checked!();
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
