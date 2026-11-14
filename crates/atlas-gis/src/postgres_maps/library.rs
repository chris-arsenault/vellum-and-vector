use super::{from_json, to_json, PostgresMaps};
use crate::map_store::{
    library::saved_document, Page, RelatedMaps, SaveRequest, SavedMap, SavedMapDocument,
};
use atlas_map::MapRef;
use std::io;
const PAGE_SIZE: usize = 256;
impl PostgresMaps {
    pub fn list_saved(&self, cursor: &str) -> io::Result<Page<SavedMap>> {
        let rows = self.query(
            "SELECT data FROM map.saved WHERE map_id>$1 ORDER BY map_id LIMIT $2",
            &[&cursor, &((PAGE_SIZE + 1) as i64)],
        )?;
        let items = rows
            .iter()
            .take(PAGE_SIZE)
            .map(|row| {
                from_json::<SavedMapDocument>(row.try_get("data").map_err(io::Error::other)?)
                    .map(|s| s.summary)
            })
            .collect::<io::Result<Vec<_>>>()?;
        let next = (rows.len() > PAGE_SIZE)
            .then(|| items.last().map(|s| s.reference.map_id.clone()))
            .flatten();
        Ok(Page { items, next })
    }
    pub fn find_saved(&self, map_id: &str) -> io::Result<Option<SavedMapDocument>> {
        let row = self
            .query("SELECT data FROM map.saved WHERE map_id=$1", &[&map_id])?
            .into_iter()
            .next();
        row.map(|row| from_json(row.try_get("data").map_err(io::Error::other)?))
            .transpose()
    }
    pub fn save(&self, request: SaveRequest, saved_at: String) -> io::Result<SavedMapDocument> {
        self.transaction(|| {
            self.lock(&request.reference.map_id)?;
            let previous=self.query("SELECT version FROM map.saved WHERE map_id=$1",&[&request.reference.map_id])?.into_iter().next().map(|row|u64::try_from(row.try_get::<_,i64>("version").map_err(io::Error::other)?).map_err(io::Error::other)).transpose()?;
            let map=self.open(&request.reference)?; self.access().validate_navigation(&request.reference, &request.navigation)?;
            let saved=saved_document(&map,request,previous,saved_at)?;
            let version=i64::try_from(saved.summary.version).map_err(io::Error::other)?;
            self.execute("INSERT INTO map.saved VALUES($1,$2,$3,$4) ON CONFLICT(map_id) DO UPDATE SET revision=excluded.revision,version=excluded.version,data=excluded.data",&[&map.reference.map_id,&map.reference.revision,&version,&to_json(&saved)?])?;Ok(saved)
        })
    }
    pub fn related(&self, r: &MapRef) -> io::Result<RelatedMaps> {
        let map = self.open(r)?;
        let children=self.query("SELECT m.map_id,m.revision FROM map.revisions m JOIN map.heads h USING(map_id,revision) WHERE descriptor#>>'{parent,mapId}'=$1 AND descriptor#>>'{parent,revision}'=$2 ORDER BY m.map_id",&[&r.map_id,&r.revision])?.iter().map(|row|Ok(MapRef{map_id:row.try_get("map_id").map_err(io::Error::other)?,revision:row.try_get("revision").map_err(io::Error::other)?})).collect::<io::Result<_>>()?;
        Ok(RelatedMaps {
            parent: map.parent,
            children,
        })
    }
}
