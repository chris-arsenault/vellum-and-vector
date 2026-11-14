//! SQLite ownership and queries shared by both execution hosts.
use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};
use std::{
    collections::BTreeMap,
    io,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}
pub type Row = BTreeMap<String, Value>;
impl From<&str> for Value {
    fn from(value: &str) -> Self {
        Self::Text(value.into())
    }
}
impl From<String> for Value {
    fn from(value: String) -> Self {
        Self::Text(value)
    }
}
impl From<i64> for Value {
    fn from(value: i64) -> Self {
        Self::Integer(value)
    }
}
impl From<f64> for Value {
    fn from(value: f64) -> Self {
        Self::Real(value)
    }
}
impl Value {
    pub fn text(&self) -> io::Result<&str> {
        if let Self::Text(value) = self {
            Ok(value)
        } else {
            Err(io::Error::other("Expected SQL text"))
        }
    }
    pub fn integer(&self) -> io::Result<i64> {
        if let Self::Integer(value) = self {
            Ok(*value)
        } else {
            Err(io::Error::other("Expected SQL integer"))
        }
    }
    pub fn bytes(&self) -> io::Result<&[u8]> {
        if let Self::Blob(value) = self {
            Ok(value)
        } else {
            Err(io::Error::other("Expected SQL bytes"))
        }
    }
}
pub struct Database {
    connection: Connection,
    _temporary: Option<TemporaryFile>,
}
struct TemporaryFile(PathBuf);
impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
impl Database {
    pub fn open(path: impl AsRef<Path>) -> io::Result<Self> {
        Ok(Self {
            connection: Connection::open(path).map_err(io::Error::other)?,
            _temporary: None,
        })
    }
    pub fn temporary(path: impl AsRef<Path>) -> io::Result<Self> {
        let path = path.as_ref();
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)?;
        let temporary = TemporaryFile(path.to_owned());
        let connection = Connection::open(path).map_err(io::Error::other)?;
        let database = Self {
            connection,
            _temporary: Some(temporary),
        };
        database.batch("PRAGMA cache_size=-4096; PRAGMA temp_store=FILE; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;")?;
        Ok(database)
    }
    pub fn batch(&self, sql: &str) -> io::Result<()> {
        self.connection.execute_batch(sql).map_err(io::Error::other)
    }
    pub fn execute(&self, sql: &str, values: &[Value]) -> io::Result<u64> {
        self.connection
            .execute(sql, params_from_iter(bindings(values)))
            .map(|count| count as u64)
            .map_err(io::Error::other)
    }
    pub fn query(&self, sql: &str, values: &[Value]) -> io::Result<Vec<Row>> {
        let mut statement = self.connection.prepare(sql).map_err(io::Error::other)?;
        let names = statement
            .column_names()
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>();
        let rows = statement
            .query_map(params_from_iter(bindings(values)), |row| {
                let mut values = Row::new();
                for (index, name) in names.iter().enumerate() {
                    let value: SqlValue = row.get(index)?;
                    values.insert(
                        name.clone(),
                        match value {
                            SqlValue::Null => Value::Null,
                            SqlValue::Integer(v) => Value::Integer(v),
                            SqlValue::Real(v) => Value::Real(v),
                            SqlValue::Text(v) => Value::Text(v),
                            SqlValue::Blob(v) => Value::Blob(v),
                        },
                    );
                }
                Ok(values)
            })
            .map_err(io::Error::other)?;
        rows.collect::<Result<_, _>>().map_err(io::Error::other)
    }
    pub fn value(&self, sql: &str, values: &[Value]) -> io::Result<Option<Value>> {
        Ok(self
            .query(sql, values)?
            .into_iter()
            .next()
            .and_then(|row| row.into_values().next()))
    }
}
fn bindings(values: &[Value]) -> Vec<SqlValue> {
    values
        .iter()
        .map(|value| match value {
            Value::Null => SqlValue::Null,
            Value::Integer(v) => SqlValue::Integer(*v),
            Value::Real(v) => SqlValue::Real(*v),
            Value::Text(v) => SqlValue::Text(v.clone()),
            Value::Blob(v) => SqlValue::Blob(v.clone()),
        })
        .collect()
}
pub fn transaction<T>(db: &Database, action: impl FnOnce() -> io::Result<T>) -> io::Result<T> {
    db.batch("BEGIN IMMEDIATE")?;
    let result = action().and_then(|value| db.batch("COMMIT").map(|()| value));
    match result {
        Ok(value) => Ok(value),
        Err(error) => {
            db.batch("ROLLBACK").map_err(|rollback| {
                io::Error::other(format!("{error}; rollback failed: {rollback}"))
            })?;
            Err(error)
        }
    }
}
/// The caller holds the platform lock for the source catalog for this operation.
pub fn attached<T>(
    db: &Database,
    source: &str,
    action: impl FnOnce() -> io::Result<T>,
) -> io::Result<T> {
    db.execute("ATTACH DATABASE ? AS imported", &[source.into()])?;
    let result = action();
    let detached = db.batch("DETACH DATABASE imported");
    match result {
        Ok(value) => detached.map(|()| value),
        Err(error) => {
            detached
                .map_err(|detach| io::Error::other(format!("{error}; detach failed: {detach}")))?;
            Err(error)
        }
    }
}
pub fn column<'a>(row: &'a Row, name: &str) -> io::Result<&'a Value> {
    row.get(name)
        .ok_or_else(|| io::Error::other(format!("Missing SQL column: {name}")))
}
