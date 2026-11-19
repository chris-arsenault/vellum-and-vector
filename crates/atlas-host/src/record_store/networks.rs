use super::{mirror::Mirror, scan, stored, Database, Key, Row};
use atlas_generation::features::network::{
    NetworkReader, NetworkWorkspace, Node, Reach, Selection,
};
use atlas_gis::{
    map_store::codec,
    sql::{column, Value},
};
use atlas_map::Id;
use std::{io, rc::Rc};

const NODE: u8 = 0;
const REACH: u8 = 1;
/// A network table holds nodes and reaches, each keyed by its kind and identity.
#[derive(Clone)]
pub(super) enum Record {
    Node(Node),
    Reach(Reach),
}
pub(super) fn create(db: &Database, table: &str) -> io::Result<()> {
    db.connection.batch(&format!(
        "CREATE TABLE {table}(
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT,kind INTEGER NOT NULL,id BLOB NOT NULL,
        data BLOB NOT NULL,UNIQUE(kind,id));"
    ))
}
fn kind(kind: u8) -> Key {
    Key::Id(2, Id::from_bytes([kind; 16]))
}
fn row(record: Record) -> Row<(u8, Id), Record> {
    let (key, keys) = match &record {
        Record::Node(node) => ((NODE, node.id), vec![kind(NODE)]),
        Record::Reach(reach) => (
            (REACH, reach.id),
            vec![
                kind(REACH),
                Key::Id(0, reach.feature_id),
                Key::Id(1, reach.start),
                Key::Id(1, reach.end),
            ],
        ),
    };
    Row {
        key,
        revision: 0,
        keys,
        value: record,
    }
}
pub(super) fn load(db: &Database, table: &str) -> io::Result<Mirror<(u8, Id), Record>> {
    let (rows, next) = stored(db, table, |stored| {
        let data = column(stored, "data")?.bytes()?;
        Ok(row(match column(stored, "kind")?.integer()? {
            0 => Record::Node(codec::decode(data)?),
            1 => Record::Reach(codec::decode(data)?),
            _ => return Err(io::Error::other("Unknown network record kind")),
        }))
    })?;
    Ok(Mirror::new(rows, next))
}
pub struct Networks {
    db: Rc<Database>,
    table: &'static str,
}
impl Networks {
    pub(super) fn new(db: Rc<Database>, table: &'static str) -> Self {
        Self { db, table }
    }
    fn record(&self, key: (u8, Id)) -> Option<Record> {
        let held = self.db.networks.borrow();
        held.get(self.table)?.get(key).map(|row| row.value.clone())
    }
    fn put(&self, record: Record) -> io::Result<()> {
        let row = row(record);
        let (kind, id) = row.key;
        let data = match &row.value {
            Record::Node(node) => codec::encode(node)?,
            Record::Reach(reach) => codec::encode(reach)?,
        };
        let ordinal = self.db.networks.borrow()[self.table].ordinal(row.key);
        self.db.connection.execute(
            &format!(
                "INSERT INTO {}(ordinal,kind,id,data) VALUES(?,?,?,?)
                 ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
                self.table
            ),
            &[
                ordinal.into(),
                i64::from(kind).into(),
                id.into(),
                Value::Blob(data),
            ],
        )?;
        self.db
            .networks
            .borrow_mut()
            .get_mut(self.table)
            .expect("Opened with the workspace")
            .put(row);
        Ok(())
    }
}
impl NetworkReader for Networks {
    fn node(&self, id: Id) -> io::Result<Option<Node>> {
        Ok(match self.record((NODE, id)) {
            Some(Record::Node(node)) => Some(node),
            _ => None,
        })
    }
    fn reach(&self, id: Id) -> io::Result<Option<Reach>> {
        Ok(match self.record((REACH, id)) {
            Some(Record::Reach(reach)) => Some(reach),
            _ => None,
        })
    }
    fn nodes(&self) -> io::Result<Box<dyn Iterator<Item = io::Result<Node>> + '_>> {
        Ok(Box::new(scan(
            |db| &db.networks,
            self.db.clone(),
            self.table,
            vec![kind(NODE)],
            |record: &Record| match record {
                Record::Node(node) => Some(node.clone()),
                Record::Reach(_) => None,
            },
        )))
    }
    fn reaches<'a>(
        &'a self,
        selection: Selection,
    ) -> io::Result<Box<dyn Iterator<Item = io::Result<Reach>> + 'a>> {
        let mut keys = vec![kind(REACH)];
        keys.extend(selection.feature_id.map(|id| Key::Id(0, id)));
        keys.extend(selection.node_id.map(|id| Key::Id(1, id)));
        Ok(Box::new(scan(
            |db| &db.networks,
            self.db.clone(),
            self.table,
            keys,
            |record: &Record| match record {
                Record::Reach(reach) => Some(reach.clone()),
                Record::Node(_) => None,
            },
        )))
    }
}
impl NetworkWorkspace for Networks {
    fn put_node(&mut self, node: Node) -> io::Result<()> {
        self.put(Record::Node(node))
    }
    fn put_reach(&mut self, reach: Reach) -> io::Result<()> {
        self.put(Record::Reach(reach))
    }
    fn remove_reach(&mut self, id: Id) -> io::Result<()> {
        self.db.connection.execute(
            &format!("DELETE FROM {} WHERE kind=? AND id=?", self.table),
            &[i64::from(REACH).into(), id.into()],
        )?;
        if let Some(mirror) = self.db.networks.borrow_mut().get_mut(self.table) {
            mirror.remove((REACH, id));
        }
        Ok(())
    }
}
