//! Disposable SQLite execution records. Published maps and completed generation inputs have their own stores.
mod features;
mod networks;
use atlas_gis::sql::{self, column, Value};
pub use features::Features;
pub use networks::Networks;
use serde::de::DeserializeOwned;
use std::{cell::Cell, collections::VecDeque, io, rc::Rc};

struct Database {
    connection: Rc<sql::Database>,
    revision: Cell<u64>,
}
/// All readers and writers hold the database alive. Source and working tables never alias.
pub struct Workspace(Rc<Database>);
impl Workspace {
    pub fn create(path: impl AsRef<std::path::Path>) -> io::Result<Self> {
        Self::open(Rc::new(sql::Database::temporary(path)?))
    }
    pub fn open(connection: Rc<sql::Database>) -> io::Result<Self> {
        let database = Rc::new(Database {
            connection,
            revision: Cell::new(0),
        });
        for table in ["working_features", "source_features"] {
            if database
                .connection
                .value(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                    &[table.into()],
                )?
                .is_none()
            {
                features::create(&database, table)?;
            }
        }
        for table in ["working_networks", "source_networks"] {
            if database
                .connection
                .value(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                    &[table.into()],
                )?
                .is_none()
            {
                networks::create(&database, table)?;
            }
        }
        Ok(Self(database))
    }
    pub fn features(&self) -> Features {
        Features::new(self.0.clone(), "working_features")
    }
    pub fn source_features(&self) -> Features {
        Features::new(self.0.clone(), "source_features")
    }
    /// Application preparation writes canonical records while execution is paused.
    pub fn begin_execution(&self) -> io::Result<()> {
        let revision = self
            .0
            .connection
            .value(
                "SELECT COALESCE(MAX(revision),0) FROM (
                SELECT revision FROM working_features UNION ALL
                SELECT revision FROM source_features)",
                &[],
            )?
            .ok_or_else(|| io::Error::other("Missing execution revision"))?
            .integer()?;
        self.0
            .revision
            .set(u64::try_from(revision).map_err(io::Error::other)?);
        Ok(())
    }
    pub fn networks(&self) -> Networks {
        Networks::new(self.0.clone(), "working_networks")
    }
    pub fn source_networks(&self) -> Networks {
        Networks::new(self.0.clone(), "source_networks")
    }
    pub fn clear_source(&self) -> io::Result<()> {
        self.0
            .connection
            .batch("DELETE FROM source_features; DELETE FROM source_networks;")
    }
    pub fn copy_sources(&self, source: &Workspace) -> io::Result<()> {
        use atlas_generation::features::{
            network::{NetworkReader, NetworkWorkspace},
            FeatureReader, FeatureWorkspace,
        };
        sql::transaction(&self.0.connection, || {
            self.clear_source()?;
            for item in source.source_features().values(Default::default())? {
                self.source_features().put(item?)?;
            }
            for item in source.source_networks().nodes()? {
                self.source_networks().put_node(item?)?;
            }
            for item in source.source_networks().reaches(Default::default())? {
                self.source_networks().put_reach(item?)?;
            }
            Ok(())
        })
    }
}
fn get<T: DeserializeOwned>(
    db: &Database,
    table: &str,
    filter: &str,
    values: &[Value],
) -> io::Result<Option<T>> {
    let value = db
        .connection
        .value(&format!("SELECT data FROM {table} WHERE {filter}"), values)?;
    value
        .map(|value| serde_json::from_str(value.text()?).map_err(Into::into))
        .transpose()
}
/// Page identities, then fetch each record at yield time so intervening writes are visible.
struct Ids {
    db: Rc<Database>,
    table: &'static str,
    filter: String,
    values: Vec<Value>,
    pending: VecDeque<(i64, atlas_map::Id)>,
    after: i64,
    done: bool,
}
impl Ids {
    fn new(db: Rc<Database>, table: &'static str, filters: &[(&str, Option<Value>)]) -> Self {
        let mut filter = String::new();
        let mut values = Vec::new();
        for (clause, value) in filters {
            if let Some(value) = value {
                filter.push_str(" AND ");
                filter.push_str(clause);
                values.push(value.clone());
            }
        }
        Self {
            db,
            table,
            filter,
            values,
            pending: VecDeque::new(),
            after: 0,
            done: false,
        }
    }
    fn page(&mut self) -> io::Result<()> {
        let sql = format!(
            "SELECT ordinal,id FROM {} WHERE ordinal>?{} ORDER BY ordinal LIMIT 64",
            self.table, self.filter
        );
        let values = std::iter::once(Value::Integer(self.after))
            .chain(self.values.iter().cloned())
            .collect::<Vec<_>>();
        self.pending = self
            .db
            .connection
            .query(&sql, &values)?
            .iter()
            .map(|row| Ok((column(row, "ordinal")?.integer()?, column(row, "id")?.id()?)))
            .collect::<io::Result<_>>()?;
        Ok(())
    }
}
impl Iterator for Ids {
    type Item = io::Result<atlas_map::Id>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        if self.pending.is_empty() {
            if let Err(error) = self.page() {
                self.done = true;
                return Some(Err(error));
            }
        }
        match self.pending.pop_front() {
            Some((ordinal, id)) => {
                self.after = ordinal;
                Some(Ok(id))
            }
            None => {
                self.done = true;
                None
            }
        }
    }
}
fn records<T: DeserializeOwned>(
    ids: Ids,
    filter: &'static str,
    prefix: Vec<Value>,
) -> impl Iterator<Item = io::Result<T>> {
    let db = ids.db.clone();
    let table = ids.table;
    ids.filter_map(move |id| {
        let result = id.and_then(|id| {
            let mut values = prefix.clone();
            values.push(id.into());
            get(&db, table, filter, &values)
        });
        result.transpose()
    })
}
