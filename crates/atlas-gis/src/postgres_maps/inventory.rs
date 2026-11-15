use super::PostgresMaps;
use crate::map_store::MapEntry;
use atlas_map::MapRef;
use std::io;

impl PostgresMaps {
    pub fn inventory(&self) -> io::Result<Vec<MapEntry>> {
        self.query("SELECT m.map_id,m.revision,m.descriptor,m.complete,EXISTS(SELECT 1 FROM map.heads h WHERE h.map_id=m.map_id AND h.revision=m.revision) AS head,EXISTS(SELECT 1 FROM map.saved s WHERE s.map_id=m.map_id AND s.revision=m.revision) AS saved FROM map.revisions m ORDER BY m.map_id,m.revision", &[])?.iter().map(|row| {
            Ok(MapEntry::from_record(MapRef { map_id: row.try_get("map_id").map_err(io::Error::other)?, revision: row.try_get("revision").map_err(io::Error::other)? }, row.try_get("descriptor").map_err(io::Error::other)?, row.try_get("complete").map_err(io::Error::other)?, row.try_get("head").map_err(io::Error::other)?, row.try_get("saved").map_err(io::Error::other)?))
        }).collect()
    }
    pub fn asset_locations(&self) -> io::Result<Vec<String>> {
        self.query("SELECT DISTINCT location FROM map.assets", &[])?
            .iter()
            .map(|r| r.try_get("location").map_err(io::Error::other))
            .collect()
    }
    pub fn delete_map(&self, id: &str) -> io::Result<()> {
        self.transaction(|| {
            self.lock(id)?;
            for row in self.query(
                "SELECT map_id,data FROM map.saved WHERE map_id<>$1 FOR UPDATE",
                &[&id],
            )? {
                if let Some((version, data)) = crate::map_store::inventory::detach_child(
                    row.try_get("data").map_err(io::Error::other)?,
                    id,
                )? {
                    let map: String = row.try_get("map_id").map_err(io::Error::other)?;
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
                self.execute(&format!("DELETE FROM {table} WHERE map_id=$1"), &[&id])?;
            }
            Ok(())
        })
    }
}
