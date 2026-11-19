//! Catalog metadata for host lifecycle management, including unreadable revisions.
use super::{column, MapStore};
use atlas_map::{Id, MapRef};
use serde::Serialize;
use serde_json::Value;
use std::io;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapEntry {
    pub reference: MapRef,
    pub name: String,
    pub parent: Option<MapRef>,
    pub profile: String,
    pub complete: bool,
    pub head: bool,
    pub saved: bool,
    pub problem: Option<String>,
}
impl MapStore {
    pub fn inventory(&self) -> io::Result<Vec<MapEntry>> {
        self.db
            .query(
                "SELECT m.map_id,m.revision,m.name,m.profile,m.parent_map_id,m.parent_revision,m.complete,
                 EXISTS(SELECT 1 FROM map_heads h WHERE h.map_id=m.map_id AND h.revision=m.revision) AS head,
                 EXISTS(SELECT 1 FROM map_saved s WHERE s.map_id=m.map_id AND s.revision=m.revision) AS saved
                 FROM maps m ORDER BY m.map_id,m.revision",
                &[],
            )?
            .iter()
            .map(|row| {
                let reference = MapRef {
                    map_id: column(row, "map_id")?.id()?,
                    revision: column(row, "revision")?.id()?,
                };
                let parent = match (
                    column(row, "parent_map_id")?.optional_id()?,
                    column(row, "parent_revision")?.optional_id()?,
                ) {
                    (Some(map_id), Some(revision)) => Some(MapRef { map_id, revision }),
                    _ => None,
                };
                Ok(MapEntry {
                    name: column(row, "name")?.text()?.into(),
                    profile: column(row, "profile")?.text()?.into(),
                    parent,
                    complete: column(row, "complete")?.flag()?,
                    head: column(row, "head")?.flag()?,
                    saved: column(row, "saved")?.flag()?,
                    problem: self.open(&reference).err().map(|e| e.to_string()),
                    reference,
                })
            })
            .collect()
    }
    pub fn asset_locations(&self) -> io::Result<Vec<String>> {
        self.db
            .query("SELECT DISTINCT location FROM map_assets", &[])?
            .iter()
            .map(|r| Ok(column(r, "location")?.text()?.into()))
            .collect()
    }
    pub fn delete_map(&self, id: Id) -> io::Result<()> {
        crate::sql::transaction(self.db.as_ref(), || {
            for row in self.db.query(
                "SELECT map_id,data FROM map_saved WHERE map_id<>?",
                &[id.into()],
            )? {
                let raw =
                    serde_json::from_str(column(&row, "data")?.text()?).unwrap_or(Value::Null);
                if let Some((version, data)) = detach_child(raw, id)? {
                    self.db.execute(
                        "UPDATE map_saved SET version=?,data=? WHERE map_id=?",
                        &[
                            i64::try_from(version).map_err(io::Error::other)?.into(),
                            serde_json::to_string(&data)?.into(),
                            column(&row, "map_id")?.clone(),
                        ],
                    )?;
                }
            }
            for table in ["map_saved", "map_heads", "maps"] {
                self.db
                    .execute(&format!("DELETE FROM {table} WHERE map_id=?"), &[id.into()])?;
            }
            Ok(())
        })
    }
}

pub(crate) fn detach_child(raw: Value, id: Id) -> io::Result<Option<(u64, Value)>> {
    let Ok(mut saved) = crate::stored::VIEW.read::<super::SavedMapDocument>(raw) else {
        return Ok(None);
    };
    let mut changed = false;
    for region in &mut saved.navigation.regions {
        if region.child.as_ref().is_some_and(|r| r.map_id == id) {
            region.child = None;
            changed = true;
        }
    }
    if !changed {
        return Ok(None);
    }
    saved.summary.version += 1;
    saved.navigation.version += 1;
    Ok(Some((
        saved.summary.version,
        crate::stored::VIEW.write(&saved)?,
    )))
}
