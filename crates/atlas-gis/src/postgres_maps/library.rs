use super::PostgresMaps;
use crate::map_store::{
    library::saved_document, Page, RelatedMaps, SaveRequest, SavedMap, SavedMapDocument,
};
use crate::stored::{read_map, VIEW};
use atlas_map::{MapDescriptor, MapRef};
use std::{collections::BTreeMap, io};
const PAGE_SIZE: usize = 256;
impl PostgresMaps {
    pub fn list_saved(&self, cursor: &str) -> io::Result<Page<SavedMap>> {
        // owner-direction(2026-11-15): if it is on the server, it is a world; no Save action is required
        let rows = self.query(
            "SELECT h.map_id,h.revision,r.descriptor,s.data FROM map.heads h JOIN map.revisions r USING(map_id,revision) LEFT JOIN map.saved s ON s.map_id=h.map_id WHERE h.map_id>$1 AND r.complete ORDER BY h.map_id LIMIT $2",
            &[&cursor, &((PAGE_SIZE + 1) as i64)],
        )?;
        let items = rows
            .iter()
            .take(PAGE_SIZE)
            .map(|row| {
                let reference = MapRef {
                    map_id: row.try_get("map_id").map_err(io::Error::other)?,
                    revision: row.try_get("revision").map_err(io::Error::other)?,
                };
                let raw: serde_json::Value = row.try_get("descriptor").map_err(io::Error::other)?;
                let preferences = row.try_get("data").map_err(io::Error::other)?;
                let result = read_map(raw.clone())
                    .and_then(|map| published_document(map, preferences))
                    .map(|s| s.summary);
                Ok(result.unwrap_or_else(|error| {
                    SavedMap::unavailable(reference, &raw.to_string(), error)
                }))
            })
            .collect::<io::Result<Vec<_>>>()?;
        let next = (rows.len() > PAGE_SIZE)
            .then(|| items.last().map(|s| s.reference.map_id.clone()))
            .flatten();
        Ok(Page { items, next })
    }
    pub fn find_saved(&self, map_id: &str) -> io::Result<Option<SavedMapDocument>> {
        let row = self
            .query("SELECT r.descriptor,s.data FROM map.heads h JOIN map.revisions r USING(map_id,revision) LEFT JOIN map.saved s ON s.map_id=h.map_id WHERE h.map_id=$1 AND r.complete", &[&map_id])?
            .into_iter()
            .next();
        row.map(|row| {
            published_document(
                read_map(row.try_get("descriptor").map_err(io::Error::other)?)?,
                row.try_get("data").map_err(io::Error::other)?,
            )
        })
        .transpose()
    }
    pub fn save(&self, mut request: SaveRequest, saved_at: String) -> io::Result<SavedMapDocument> {
        // Version zero represents published geography with no stored view preferences yet.
        request.expected_version = request.expected_version.filter(|version| *version != 0);
        self.transaction(|| {
            self.lock(&request.reference.map_id)?;
            let previous=self.query("SELECT version FROM map.saved WHERE map_id=$1",&[&request.reference.map_id])?.into_iter().next().map(|row|u64::try_from(row.try_get::<_,i64>("version").map_err(io::Error::other)?).map_err(io::Error::other)).transpose()?;
            let map=self.open(&request.reference)?; self.access().validate_navigation(&request.reference, &request.navigation)?;
            let saved=saved_document(&map,request,previous,saved_at)?;
            let version=i64::try_from(saved.summary.version).map_err(io::Error::other)?;
            self.execute("INSERT INTO map.saved VALUES($1,$2,$3,$4) ON CONFLICT(map_id) DO UPDATE SET revision=excluded.revision,version=excluded.version,data=excluded.data",&[&map.reference.map_id,&map.reference.revision,&version,&VIEW.write(&saved)?])?;Ok(saved)
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

fn published_document(
    map: MapDescriptor,
    preferences: Option<serde_json::Value>,
) -> io::Result<SavedMapDocument> {
    let previous = preferences
        .map(|value| VIEW.read::<SavedMapDocument>(value))
        .transpose()?;
    let version = match previous {
        Some(saved) if saved.summary.reference == map.reference => return Ok(saved),
        Some(saved) => saved.summary.version,
        None => 0,
    };
    Ok(SavedMapDocument {
        summary: SavedMap {
            reference: map.reference,
            name: map.name,
            saved_at: String::new(),
            version,
            problem: None,
        },
        navigation: Default::default(),
        settings: BTreeMap::new(),
    })
}
