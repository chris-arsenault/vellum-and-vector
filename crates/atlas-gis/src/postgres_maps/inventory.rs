use super::{id, uuid, PostgresMaps};
use crate::map_store::MapEntry;
use atlas_map::{Id, MapRef};
use std::io;

impl PostgresMaps {
    pub fn inventory(&self) -> io::Result<Vec<MapEntry>> {
        self.query(
            "SELECT m.map_id,m.revision,m.name,m.profile,m.parent_map_id,m.parent_revision,m.complete,
             EXISTS(SELECT 1 FROM map.heads h WHERE h.map_id=m.map_id AND h.revision=m.revision) AS head,
             EXISTS(SELECT 1 FROM map.saved s WHERE s.map_id=m.map_id AND s.revision=m.revision) AS saved
             FROM map.revisions m ORDER BY m.map_id,m.revision",
            &[],
        )?
        .iter()
        .map(|row| {
            let get = |name: &str| row.try_get::<_, uuid::Uuid>(name).map_err(io::Error::other);
            let reference = MapRef {
                map_id: id(get("map_id")?),
                revision: id(get("revision")?),
            };
            let parent = match (
                row.try_get::<_, Option<uuid::Uuid>>("parent_map_id")
                    .map_err(io::Error::other)?,
                row.try_get::<_, Option<uuid::Uuid>>("parent_revision")
                    .map_err(io::Error::other)?,
            ) {
                (Some(map_id), Some(revision)) => Some(MapRef {
                    map_id: id(map_id),
                    revision: id(revision),
                }),
                _ => None,
            };
            let problem = self.open(&reference).err().map(|e| e.to_string());
            Ok(MapEntry {
                name: row.try_get("name").map_err(io::Error::other)?,
                profile: row.try_get("profile").map_err(io::Error::other)?,
                parent,
                complete: row.try_get("complete").map_err(io::Error::other)?,
                head: row.try_get("head").map_err(io::Error::other)?,
                saved: row.try_get("saved").map_err(io::Error::other)?,
                problem,
                reference,
            })
        })
        .collect()
    }
    pub fn asset_locations(&self) -> io::Result<Vec<String>> {
        self.query("SELECT DISTINCT location FROM map.assets", &[])?
            .iter()
            .map(|r| r.try_get("location").map_err(io::Error::other))
            .collect()
    }
    pub fn delete_map(&self, map_id: Id) -> io::Result<()> {
        self.transaction(|| {
            self.lock(map_id)?;
            for row in self.query(
                "SELECT map_id,data FROM map.saved WHERE map_id<>$1 FOR UPDATE",
                &[&uuid(map_id)],
            )? {
                if let Some((version, data)) = crate::map_store::inventory::detach_child(
                    row.try_get("data").map_err(io::Error::other)?,
                    map_id,
                )? {
                    let map: uuid::Uuid = row.try_get("map_id").map_err(io::Error::other)?;
                    self.execute(
                        "UPDATE map.saved SET version=$1,data=$2 WHERE map_id=$3",
                        &[
                            &i64::try_from(version).map_err(io::Error::other)?,
                            &data,
                            &map,
                        ],
                    )?;
                }
            }
            for table in ["map.saved", "map.heads", "map.revisions"] {
                self.execute(
                    &format!("DELETE FROM {table} WHERE map_id=$1"),
                    &[&uuid(map_id)],
                )?;
            }
            Ok(())
        })
    }
}
