use super::{queries::PAGE_SIZE, reference_values, MapStore, Page};
use crate::sql::{column, transaction};
use atlas_map::{MapNavigationState, MapRef, PublicationState};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    pub reference: MapRef,
    pub expected_version: Option<u64>,
    // owner-direction(2026-11-13): preserve explicit saves; working regions and views stay local until saved
    pub navigation: MapNavigationState,
    pub settings: BTreeMap<String, serde_json::Value>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedMap {
    pub reference: MapRef,
    pub name: String,
    pub saved_at: String,
    pub version: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedMapDocument {
    #[serde(flatten)]
    pub summary: SavedMap,
    pub navigation: MapNavigationState,
    pub settings: BTreeMap<String, serde_json::Value>,
}
#[derive(Serialize, Deserialize)]
pub struct RelatedMaps {
    pub parent: Option<MapRef>,
    pub children: Vec<MapRef>,
}
impl MapStore {
    pub fn list_saved(&self, cursor: &str) -> io::Result<Page<SavedMap>> {
        let rows = self.db.query(
            "SELECT map_id,revision,data FROM map_saved WHERE map_id>? ORDER BY map_id LIMIT ?",
            &[cursor.into(), ((PAGE_SIZE + 1) as i64).into()],
        )?;
        let more = rows.len() > PAGE_SIZE;
        let items = rows
            .iter()
            .take(PAGE_SIZE)
            .map(|row| {
                let reference = MapRef {
                    map_id: column(row, "map_id")?.text()?.into(),
                    revision: column(row, "revision")?.text()?.into(),
                };
                let raw = column(row, "data")?.text()?;
                let result = crate::stored::VIEW
                    .parse::<SavedMapDocument>(raw)
                    .and_then(|saved| self.open(&reference).map(|_| saved.summary));
                Ok(result.unwrap_or_else(|error| SavedMap::unavailable(reference, raw, error)))
            })
            .collect::<io::Result<Vec<_>>>()?;
        let next = more
            .then(|| items.last().map(|s| s.reference.map_id.clone()))
            .flatten();
        Ok(Page { items, next })
    }
    pub fn find_saved(&self, map_id: &str) -> io::Result<Option<SavedMapDocument>> {
        let data = self.db.value(
            "SELECT data FROM map_saved WHERE map_id=?",
            &[map_id.into()],
        )?;
        data.map(|data| {
            let saved: SavedMapDocument = crate::stored::VIEW.parse(data.text()?)?;
            self.open(&saved.summary.reference)?;
            Ok(saved)
        })
        .transpose()
    }
    pub fn save(&self, request: SaveRequest, saved_at: String) -> io::Result<SavedMapDocument> {
        transaction(self.db.as_ref(), || self.save_inner(request, saved_at))
    }
    pub(super) fn save_inner(
        &self,
        request: SaveRequest,
        saved_at: String,
    ) -> io::Result<SavedMapDocument> {
        let previous = self
            .db
            .value(
                "SELECT version FROM map_saved WHERE map_id=?",
                &[request.reference.map_id.clone().into()],
            )?
            .map(|v| {
                v.integer()
                    .and_then(|v| u64::try_from(v).map_err(io::Error::other))
            })
            .transpose()?;
        let map = self.open(&request.reference)?;
        self.access()
            .validate_navigation(&request.reference, &request.navigation)?;
        let saved = saved_document(&map, request, previous, saved_at)?;
        let version = saved.summary.version;
        let mut values = reference_values(&map.reference);
        values.extend([
            i64::try_from(version).map_err(io::Error::other)?.into(),
            crate::stored::VIEW.text(&saved)?.into(),
        ]);
        self.db.execute("INSERT INTO map_saved VALUES(?,?,?,?) ON CONFLICT(map_id) DO UPDATE SET revision=excluded.revision,version=excluded.version,data=excluded.data", &values)?;
        self.set_head(&map.reference)?;
        Ok(saved)
    }
    pub fn related(&self, reference: &MapRef) -> io::Result<RelatedMaps> {
        let map = self.open(reference)?;
        let rows = self.db.query("SELECT m.map_id,m.revision FROM maps m JOIN map_heads h USING(map_id,revision) WHERE json_extract(descriptor,'$.parent.mapId')=? AND json_extract(descriptor,'$.parent.revision')=? ORDER BY m.map_id", &reference_values(reference))?;
        let children = rows
            .iter()
            .map(|row| {
                Ok(MapRef {
                    map_id: column(row, "map_id")?.text()?.into(),
                    revision: column(row, "revision")?.text()?.into(),
                })
            })
            .collect::<io::Result<_>>()?;
        Ok(RelatedMaps {
            parent: map.parent,
            children,
        })
    }
}

pub(crate) fn saved_document(
    map: &atlas_map::MapDescriptor,
    request: SaveRequest,
    previous: Option<u64>,
    saved_at: String,
) -> io::Result<SavedMapDocument> {
    if map.state != PublicationState::Complete {
        return Err(io::Error::other("Complete the map before saving it"));
    }
    if previous != request.expected_version {
        return Err(io::Error::other(
            "The saved map changed. Reopen it before saving",
        ));
    }
    let version = previous
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| io::Error::other("Saved map version overflow"))?;
    Ok(SavedMapDocument {
        summary: SavedMap {
            reference: map.reference.clone(),
            name: map.name.clone(),
            saved_at,
            version,
            problem: None,
        },
        navigation: request.navigation,
        settings: request.settings,
    })
}

impl SavedMap {
    pub(crate) fn unavailable(reference: MapRef, raw: &str, error: io::Error) -> Self {
        let value: serde_json::Value = serde_json::from_str(raw).unwrap_or_default();
        Self {
            name: value["name"].as_str().unwrap_or(&reference.map_id).into(),
            saved_at: value["savedAt"].as_str().unwrap_or_default().into(),
            version: value["version"].as_u64().unwrap_or_default(),
            reference,
            problem: Some(error.to_string()),
        }
    }
}
