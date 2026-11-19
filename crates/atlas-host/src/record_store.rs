//! Disposable SQLite execution records. Published maps and completed generation inputs have their own stores.
//!
//! Each table is held decoded in memory with indexes for the generator's selections, and its
//! rows are written through to SQLite as CBOR. The file is what checkpoints, recovery and
//! child capture copy; reads never decode it after the workspace opens.
mod features;
mod mirror;
mod networks;
use atlas_generation::features::Feature;
use atlas_gis::sql::{self, column};
pub use features::Features;
use mirror::{Key, Mirror, Row};
pub use networks::Networks;
use networks::Record;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    io,
    rc::Rc,
};

/// The kind of a record retained with a completed map's inputs, stored as its code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Retained {
    Feature = 0,
    Node = 1,
    Reach = 2,
}
/// A table's mirror by table name.
type Mirrors<K, T> = RefCell<HashMap<&'static str, Mirror<K, T>>>;
struct Database {
    connection: Rc<sql::Database>,
    revision: Cell<u64>,
    features: Mirrors<atlas_map::Id, Feature>,
    networks: Mirrors<(u8, atlas_map::Id), Record>,
}
/// All readers and writers hold the database alive. Source and working tables never alias.
pub struct Workspace(Rc<Database>);
impl Workspace {
    pub fn create(path: impl AsRef<std::path::Path>) -> io::Result<Self> {
        Self::open(Rc::new(sql::Database::temporary(path)?))
    }
    pub fn open(connection: Rc<sql::Database>) -> io::Result<Self> {
        let database = Database {
            connection,
            revision: Cell::new(0),
            features: RefCell::new(HashMap::new()),
            networks: RefCell::new(HashMap::new()),
        };
        for table in ["working_features", "source_features"] {
            if !exists(&database, table)? {
                features::create(&database, table)?;
            }
            let mirror = features::load(&database, table)?;
            database.features.borrow_mut().insert(table, mirror);
        }
        for table in ["working_networks", "source_networks"] {
            if !exists(&database, table)? {
                networks::create(&database, table)?;
            }
            let mirror = networks::load(&database, table)?;
            database.networks.borrow_mut().insert(table, mirror);
        }
        Ok(Self(Rc::new(database)))
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
            .features
            .borrow()
            .values()
            .flat_map(Mirror::rows)
            .map(|row| row.revision)
            .max()
            .unwrap_or(0);
        self.0.revision.set(revision);
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
            .batch("DELETE FROM source_features; DELETE FROM source_networks;")?;
        if let Some(mirror) = self.0.features.borrow_mut().get_mut("source_features") {
            mirror.clear();
        }
        if let Some(mirror) = self.0.networks.borrow_mut().get_mut("source_networks") {
            mirror.clear();
        }
        Ok(())
    }
    pub fn copy_sources(&self, source: &Workspace) -> io::Result<()> {
        use atlas_generation::features::{
            network::{NetworkReader, NetworkWorkspace},
            FeatureReader, FeatureWorkspace,
        };
        let copied = sql::transaction(&self.0.connection, || {
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
        });
        if copied.is_err() {
            // The file rolled back; the memory copy follows whatever the file now holds.
            let features = features::load(&self.0, "source_features")?;
            self.0
                .features
                .borrow_mut()
                .insert("source_features", features);
            let networks = networks::load(&self.0, "source_networks")?;
            self.0
                .networks
                .borrow_mut()
                .insert("source_networks", networks);
        }
        copied
    }
}
fn exists(database: &Database, table: &str) -> io::Result<bool> {
    Ok(database
        .connection
        .value(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            &[table.into()],
        )?
        .is_some())
}
/// The table's rows in ordinal order, and the first ordinal it has never used.
fn stored<K, T>(
    database: &Database,
    table: &str,
    row: impl Fn(&sql::Row) -> io::Result<Row<K, T>>,
) -> io::Result<(Vec<(i64, Row<K, T>)>, i64)> {
    let rows = database
        .connection
        .query(&format!("SELECT * FROM {table} ORDER BY ordinal"), &[])?
        .iter()
        .map(|stored| Ok((column(stored, "ordinal")?.integer()?, row(stored)?)))
        .collect::<io::Result<Vec<_>>>()?;
    // AUTOINCREMENT never reuses an ordinal, even one whose row was deleted.
    let used = database
        .connection
        .value(
            "SELECT seq FROM sqlite_sequence WHERE name=?",
            &[table.into()],
        )?
        .map(|value| value.integer())
        .transpose()?
        .unwrap_or(0);
    Ok((rows, used + 1))
}
/// Records of one table that hold every key, read at yield time so writes made during the
/// scan are seen.
fn scan<K: Copy + Eq + std::hash::Hash + 'static, T: Clone + 'static, U>(
    mirrors: impl Fn(&Database) -> &Mirrors<K, T> + 'static,
    db: Rc<Database>,
    table: &'static str,
    keys: Vec<Key>,
    pick: impl Fn(&T) -> Option<U> + 'static,
) -> impl Iterator<Item = io::Result<U>> {
    let mut after = 0;
    std::iter::from_fn(move || loop {
        let held = mirrors(&db).borrow();
        let (ordinal, row) = held.get(table)?.next_after(after, &keys)?;
        after = ordinal;
        if let Some(value) = pick(&row.value) {
            return Some(Ok(value));
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use atlas_generation::features::{FeatureReader, FeatureSelection, FeatureWorkspace};
    use atlas_map::Id;

    fn feature(name: &str, area: &str, kind: &str) -> Feature {
        serde_json::from_value(serde_json::json!({
            "id":Id::from_name(name),"name":name,"kind":kind,"layerId":"settlements",
            "areaId":Id::from_name(area),"geometry":{"type":"Point","coordinates":[1,2]},
            "detail":{},"attributes":{"people":12},"relations":[],"state":"generated",
            "protected":false,"actor":"generator","generationId":null,"causes":[],
            "generationDomain":null
        }))
        .unwrap()
    }
    /// Records written are found by selection, survive reopening the file, and keep their
    /// place when rewritten; a removed record is gone from both.
    #[test]
    fn records_are_selected_from_memory_and_kept_in_the_file() {
        let path = std::env::temp_dir().join(format!("records-{}.sqlite", uuid::Uuid::new_v4()));
        {
            let workspace = Workspace::open(Rc::new(sql::Database::open(&path).unwrap())).unwrap();
            let mut features = workspace.features();
            for (name, area, kind) in [("a", "x", "town"), ("b", "y", "town"), ("c", "x", "hamlet")]
            {
                features.put(feature(name, area, kind)).unwrap();
            }
            let mut renamed = feature("a", "x", "town");
            renamed.name = "Alder".into();
            features.put(renamed).unwrap();
            features.remove(Id::from_name("b")).unwrap();
        }
        let workspace = Workspace::open(Rc::new(sql::Database::open(&path).unwrap())).unwrap();
        workspace.begin_execution().unwrap();
        let features = workspace.features();
        let names = |selection: FeatureSelection<'_>| -> Vec<String> {
            features
                .values(selection)
                .unwrap()
                .map(|f| f.unwrap().name)
                .collect()
        };
        assert_eq!(names(Default::default()), ["Alder", "c"]);
        let area = FeatureSelection {
            area_id: Some(Id::from_name("x")),
            kind: Some("hamlet"),
            ..Default::default()
        };
        assert_eq!(names(area), ["c"]);
        assert!(features.get(Id::from_name("b")).unwrap().is_none());
        assert_eq!(
            features
                .get(Id::from_name("a"))
                .unwrap()
                .unwrap()
                .attributes["people"],
            12
        );
        // The run's revision counter continues from the stored records.
        assert_eq!(workspace.0.revision.get(), 4);
        drop((features, workspace));
        std::fs::remove_file(path).unwrap();
    }
}
