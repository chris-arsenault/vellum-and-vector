use super::{mirror::Mirror, scan, stored, Database, Key, Row};
use atlas_generation::features::{
    workspace::Revisions, Feature, FeatureReader, FeatureSelection, FeatureWorkspace,
};
use atlas_gis::{
    map_store::codec,
    sql::{column, Value},
};
use atlas_map::Id;
use std::{io, rc::Rc};

pub(super) fn create(db: &Database, table: &str) -> io::Result<()> {
    db.connection.batch(&format!("CREATE TABLE {table}(
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id BLOB NOT NULL UNIQUE, revision INTEGER NOT NULL,
        area_id BLOB NOT NULL, layer_id TEXT NOT NULL, kind TEXT NOT NULL, data BLOB NOT NULL);"))
}
/// The selection keys a feature is found by: its area, layer and kind.
fn keys(area: Option<Id>, layer: Option<&str>, kind: Option<&str>) -> Vec<Key> {
    let mut keys = Vec::new();
    keys.extend(area.map(|id| Key::Id(0, id)));
    keys.extend(layer.map(|id| Key::Text(1, id.into())));
    keys.extend(kind.map(|kind| Key::Text(2, kind.into())));
    keys
}
fn row(feature: Feature, revision: u64) -> Row<Id, Feature> {
    Row {
        key: feature.id,
        revision,
        keys: keys(
            Some(feature.area_id),
            Some(&feature.layer_id),
            Some(&feature.kind),
        ),
        value: feature,
    }
}
pub(super) fn load(db: &Database, table: &str) -> io::Result<Mirror<Id, Feature>> {
    let (rows, next) = stored(db, table, |stored| {
        let revision =
            u64::try_from(column(stored, "revision")?.integer()?).map_err(io::Error::other)?;
        Ok(row(
            codec::decode(column(stored, "data")?.bytes()?)?,
            revision,
        ))
    })?;
    Ok(Mirror::new(rows, next))
}
pub struct Features {
    db: Rc<Database>,
    table: &'static str,
}
impl Features {
    pub(super) fn new(db: Rc<Database>, table: &'static str) -> Self {
        Self { db, table }
    }
}
impl FeatureReader for Features {
    fn get(&self, id: Id) -> io::Result<Option<Feature>> {
        let held = self.db.features.borrow();
        Ok(held
            .get(self.table)
            .and_then(|mirror| mirror.get(id))
            .map(|row| row.value.clone()))
    }
    fn values<'a>(
        &'a self,
        selection: FeatureSelection<'a>,
    ) -> io::Result<Box<dyn Iterator<Item = io::Result<Feature>> + 'a>> {
        let keys = keys(selection.area_id, selection.layer_id, selection.kind);
        Ok(Box::new(scan(
            |db| &db.features,
            self.db.clone(),
            self.table,
            keys,
            |feature: &Feature| Some(feature.clone()),
        )))
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
        let ordinal = self.db.features.borrow()[self.table].ordinal(feature.id);
        self.db.connection.execute(
            &format!(
                "INSERT INTO {}(ordinal,id,revision,area_id,layer_id,kind,data)
            VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,area_id=excluded.area_id,
            layer_id=excluded.layer_id,kind=excluded.kind,data=excluded.data",
                self.table
            ),
            &[
                ordinal.into(),
                feature.id.into(),
                i64::try_from(revision).map_err(io::Error::other)?.into(),
                feature.area_id.into(),
                feature.layer_id.as_str().into(),
                feature.kind.as_str().into(),
                Value::Blob(codec::encode(&feature)?),
            ],
        )?;
        self.db
            .features
            .borrow_mut()
            .get_mut(self.table)
            .expect("Opened with the workspace")
            .put(row(feature, revision));
        self.db.revision.set(revision);
        Ok(())
    }
    fn remove(&mut self, id: Id) -> io::Result<()> {
        self.db.connection.execute(
            &format!("DELETE FROM {} WHERE id=?", self.table),
            &[id.into()],
        )?;
        if let Some(mirror) = self.db.features.borrow_mut().get_mut(self.table) {
            mirror.remove(id);
        }
        Ok(())
    }
    fn revisions(&self) -> io::Result<Revisions<'_>> {
        let held = self.db.features.borrow();
        let revisions: Vec<_> = held[self.table]
            .rows()
            .map(|row| Ok((row.key, row.revision)))
            .collect();
        Ok(Box::new(revisions.into_iter()))
    }
}
