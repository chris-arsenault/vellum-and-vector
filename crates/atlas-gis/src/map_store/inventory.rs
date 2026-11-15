//! Catalog metadata for host lifecycle management, including unreadable revisions.
use super::{column, MapStore};
use atlas_map::MapRef;
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
impl MapEntry {
    pub fn from_record(
        reference: MapRef,
        raw: Value,
        complete: bool,
        head: bool,
        saved: bool,
    ) -> Self {
        let problem = crate::stored::read_map(raw.clone())
            .err()
            .map(|e| e.to_string());
        Self {
            name: raw["name"].as_str().unwrap_or(&reference.map_id).into(),
            parent: serde_json::from_value(raw["parent"].clone()).ok().flatten(),
            profile: raw["profile"].as_str().unwrap_or("unknown").into(),
            reference,
            complete,
            head,
            saved,
            problem,
        }
    }
}
impl MapStore {
    pub fn inventory(&self) -> io::Result<Vec<MapEntry>> {
        self.db.query("SELECT m.map_id,m.revision,m.descriptor,m.complete,EXISTS(SELECT 1 FROM map_heads h WHERE h.map_id=m.map_id AND h.revision=m.revision) AS head,EXISTS(SELECT 1 FROM map_saved s WHERE s.map_id=m.map_id AND s.revision=m.revision) AS saved FROM maps m ORDER BY m.map_id,m.revision", &[])?.iter().map(|row| {
            let raw = serde_json::from_str(column(row,"descriptor")?.text()?).unwrap_or(Value::Null);
            Ok(MapEntry::from_record(MapRef { map_id: column(row,"map_id")?.text()?.into(), revision: column(row,"revision")?.text()?.into() }, raw, column(row,"complete")?.integer()? != 0, column(row,"head")?.integer()? != 0, column(row,"saved")?.integer()? != 0))
        }).collect()
    }
    pub fn asset_locations(&self) -> io::Result<Vec<String>> {
        self.db
            .query("SELECT DISTINCT location FROM map_assets", &[])?
            .iter()
            .map(|r| Ok(column(r, "location")?.text()?.into()))
            .collect()
    }
    pub fn delete_map(&self, id: &str) -> io::Result<()> {
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
                            column(&row, "map_id")?.text()?.into(),
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

pub(crate) fn detach_child(raw: Value, id: &str) -> io::Result<Option<(u64, Value)>> {
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
