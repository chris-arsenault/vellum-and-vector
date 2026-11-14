use super::{get, records, Database, Ids};
use atlas_generation::features::network::{
    NetworkReader, NetworkWorkspace, Node, Reach, Selection,
};
use atlas_gis::sql::Value;
use serde::{de::DeserializeOwned, Serialize};
use std::{io, rc::Rc};

pub(super) fn create(db: &Database, table: &str) -> io::Result<()> {
    db.connection.batch(&format!(
        "CREATE TABLE {table}(
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL,
        feature_id TEXT,start_id TEXT,end_id TEXT,data TEXT NOT NULL,UNIQUE(kind,id));
        CREATE INDEX {table}_feature ON {table}(feature_id);
        CREATE INDEX {table}_start ON {table}(start_id);
        CREATE INDEX {table}_end ON {table}(end_id);"
    ))
}
pub struct Networks {
    db: Rc<Database>,
    table: &'static str,
}
impl Networks {
    pub(super) fn new(db: Rc<Database>, table: &'static str) -> Self {
        Self { db, table }
    }
    fn record<T: DeserializeOwned>(&self, kind: &str, id: &str) -> io::Result<Option<T>> {
        get(
            &self.db,
            self.table,
            "kind=? AND id=?",
            &[Value::Text(kind.to_owned()), Value::Text(id.to_owned())],
        )
    }
    fn selected<T: DeserializeOwned>(
        &self,
        kind: &str,
        selection: Selection<'_>,
    ) -> impl Iterator<Item = io::Result<T>> {
        let ids = Ids::new(
            self.db.clone(),
            self.table,
            &[
                ("kind=?", Some(kind)),
                ("feature_id=?", selection.feature_id),
                ("? IN (start_id,end_id)", selection.node_id),
            ],
        );
        records(ids, "kind=? AND id=?", vec![Value::Text(kind.to_owned())])
    }
    fn put(
        &self,
        kind: &str,
        id: &str,
        value: &impl Serialize,
        endpoints: [Option<&str>; 3],
    ) -> io::Result<()> {
        self.db.connection.execute(&format!("INSERT INTO {}(kind,id,feature_id,start_id,end_id,data) VALUES(?,?,?,?,?,?)
            ON CONFLICT(kind,id) DO UPDATE SET feature_id=excluded.feature_id,start_id=excluded.start_id,
            end_id=excluded.end_id,data=excluded.data", self.table),
            &[kind.into(), id.into(), endpoints[0].map_or(Value::Null,Value::from), endpoints[1].map_or(Value::Null,Value::from), endpoints[2].map_or(Value::Null,Value::from), serde_json::to_string(value)?.into()],
        )?;
        Ok(())
    }
}
impl NetworkReader for Networks {
    fn node(&self, id: &str) -> io::Result<Option<Node>> {
        self.record("node", id)
    }
    fn reach(&self, id: &str) -> io::Result<Option<Reach>> {
        self.record("reach", id)
    }
    fn nodes(&self) -> io::Result<Box<dyn Iterator<Item = io::Result<Node>> + '_>> {
        Ok(Box::new(self.selected("node", Selection::default())))
    }
    fn reaches<'a>(
        &'a self,
        selection: Selection<'a>,
    ) -> io::Result<Box<dyn Iterator<Item = io::Result<Reach>> + 'a>> {
        Ok(Box::new(self.selected("reach", selection)))
    }
}
impl NetworkWorkspace for Networks {
    fn put_node(&mut self, node: Node) -> io::Result<()> {
        self.put("node", &node.id, &node, [None; 3])
    }
    fn put_reach(&mut self, reach: Reach) -> io::Result<()> {
        self.put(
            "reach",
            &reach.id,
            &reach,
            [
                Some(&reach.feature_id),
                Some(&reach.start),
                Some(&reach.end),
            ],
        )
    }
    fn remove_reach(&mut self, id: &str) -> io::Result<()> {
        self.db.connection.execute(
            &format!("DELETE FROM {} WHERE kind='reach' AND id=?", self.table),
            &[id.into()],
        )?;
        Ok(())
    }
}
