use super::{get, records, Database, Ids};
use atlas_generation::features::{
    workspace::Revisions, Feature, FeatureReader, FeatureSelection, FeatureWorkspace,
};
use atlas_gis::sql::Value;
use std::{io, rc::Rc};

pub(super) fn create(db: &Database, table: &str) -> io::Result<()> {
    db.connection.batch(&format!("CREATE TABLE {table}(
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL,
        area_id TEXT NOT NULL, layer_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX {table}_selection ON {table}(area_id,layer_id,kind);"))
}
pub struct Features {
    db: Rc<Database>,
    table: &'static str,
}
impl Features {
    pub(super) fn new(db: Rc<Database>, table: &'static str) -> Self {
        Self { db, table }
    }
    fn ids(&self, selection: FeatureSelection<'_>) -> Ids {
        Ids::new(
            self.db.clone(),
            self.table,
            &[
                ("area_id=?", selection.area_id),
                ("layer_id=?", selection.layer_id),
                ("kind=?", selection.kind),
            ],
        )
    }
}
impl FeatureReader for Features {
    fn get(&self, id: &str) -> io::Result<Option<Feature>> {
        get(&self.db, self.table, "id=?", &[Value::Text(id.to_owned())])
    }
    fn values<'a>(
        &'a self,
        selection: FeatureSelection<'a>,
    ) -> io::Result<Box<dyn Iterator<Item = io::Result<Feature>> + 'a>> {
        Ok(Box::new(records(self.ids(selection), "id=?", Vec::new())))
    }
}
impl FeatureWorkspace for Features {
    fn put(&mut self, feature: Feature) -> io::Result<()> {
        // Every handle shares this run's counter; deletion cannot reset revisions.
        let revision = self
            .db
            .revision
            .get()
            .checked_add(1)
            .ok_or_else(|| io::Error::other("Feature revision overflow"))?;
        self.db.connection.execute(
            &format!(
                "INSERT INTO {}(id,revision,area_id,layer_id,kind,data)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,area_id=excluded.area_id,
            layer_id=excluded.layer_id,kind=excluded.kind,data=excluded.data",
                self.table
            ),
            &[
                feature.id.as_str().into(),
                i64::try_from(revision).map_err(io::Error::other)?.into(),
                feature.area_id.as_str().into(),
                feature.layer_id.as_str().into(),
                feature.kind.as_str().into(),
                serde_json::to_string(&feature)?.into(),
            ],
        )?;
        self.db.revision.set(revision);
        Ok(())
    }
    fn remove(&mut self, id: &str) -> io::Result<()> {
        self.db.connection.execute(
            &format!("DELETE FROM {} WHERE id=?", self.table),
            &[id.into()],
        )?;
        Ok(())
    }
    fn revisions(&self) -> io::Result<Revisions<'_>> {
        let ids = self.ids(FeatureSelection::default());
        Ok(Box::new(ids.filter_map(move |id| {
            let result = id.and_then(|id| {
                self.db
                    .connection
                    .value(
                        &format!("SELECT revision FROM {} WHERE id=?", self.table),
                        &[id.as_str().into()],
                    )?
                    .map(|value| {
                        Ok((
                            id,
                            u64::try_from(value.integer()?).map_err(io::Error::other)?,
                        ))
                    })
                    .transpose()
            });
            result.transpose()
        })))
    }
}
