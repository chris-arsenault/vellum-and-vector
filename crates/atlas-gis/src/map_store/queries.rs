use super::{codec, reference_values, space, MapStore};
use crate::sql::{column, Row, Value};
use atlas_map::{
    spatial::Predicate, Bounds, Geometry, HistoryEntry, MapEntity, MapFeature, MapRef,
    PublishedAsset,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, io};

pub(super) const PAGE_SIZE: usize = 256;
pub(super) const WINDOW: &str = "b.max_x>=? AND b.min_x<=? AND b.max_y>=? AND b.min_y<=?";
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureQuery {
    pub space_id: String,
    pub bounds: Option<Bounds>,
    pub geometry: Option<Geometry>,
    pub feature_ids: Option<Vec<String>>,
    pub layer_ids: Option<Vec<String>>,
    pub text: Option<String>,
    pub cursor: Option<String>,
    /// Bounds meet a feature's footprint as well as its geometry, as hex marks do.
    #[serde(default)]
    pub footprints: bool,
}
#[derive(Serialize, Deserialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next: Option<String>,
}
impl MapStore {
    pub fn asset(&self, reference: &MapRef, id: &str) -> io::Result<PublishedAsset> {
        let mut values = reference_values(reference);
        values.push(id.into());
        let row = self
            .db
            .query(
                "SELECT * FROM map_assets WHERE map_id=? AND revision=? AND id=?",
                &values,
            )?
            .into_iter()
            .next()
            .ok_or_else(|| io::Error::other("Map asset was not found"))?;
        Ok(PublishedAsset {
            id: id.into(),
            media_type: column(&row, "media_type")?.text()?.into(),
            location: column(&row, "location")?.text()?.into(),
            byte_length: u64::try_from(column(&row, "byte_length")?.integer()?)
                .map_err(io::Error::other)?,
            illustration: column(&row, "illustration")?.integer()? != 0,
        })
    }
    pub fn illustration_assets(&self, reference: &MapRef) -> io::Result<Vec<PublishedAsset>> {
        self.open(reference)?;
        self.db.query("SELECT id FROM map_assets WHERE map_id=? AND revision=? AND illustration=1 ORDER BY id", &reference_values(reference))?.iter().map(|row| self.asset(reference, column(row, "id")?.text()?)).collect()
    }
    pub fn features(
        &self,
        reference: &MapRef,
        query: &FeatureQuery,
    ) -> io::Result<Page<MapFeature>> {
        let map = self.open(reference)?;
        let space = space(&map, &query.space_id)?;
        let bounds = query.bounds.map(Ok).unwrap_or_else(|| {
            query.geometry.as_ref().map_or(Ok(space.bounds), |shape| {
                self.geometry
                    .encode(shape, space.precision)
                    .map(|encoded| encoded.bounds)
            })
        })?;
        bounds.validate_window().map_err(io::Error::other)?;
        let rows = self.feature_rows(reference, query, bounds)?;
        let has_more = rows.len() > PAGE_SIZE;
        let selected = rows.into_iter().take(PAGE_SIZE).collect::<Vec<_>>();
        let next = if has_more {
            selected
                .last()
                .map(|row| column(row, "id")?.text().map(String::from))
                .transpose()?
        } else {
            None
        };
        let kernel = self.geometry.spatial(space.precision)?;
        let mut items = Vec::new();
        for row in selected {
            let feature = self.feature(&row)?;
            if let Some(shape) = &query.geometry {
                if !kernel
                    .relation(&feature.geometry, shape, Predicate::Intersects)
                    .map_err(io::Error::other)?
                {
                    continue;
                }
            }
            items.push(feature);
        }
        Ok(Page { items, next })
    }
    fn feature_rows(
        &self,
        reference: &MapRef,
        query: &FeatureQuery,
        Bounds(w, s, e, n): Bounds,
    ) -> io::Result<Vec<Row>> {
        let mut values = reference_values(reference);
        values.extend([
            query.space_id.clone().into(),
            query.cursor.clone().unwrap_or_default().into(),
            w.into(),
            e.into(),
            s.into(),
            n.into(),
        ]);
        let mut clauses = vec![format!(
            "f.map_id=? AND f.revision=? AND f.space_id=? AND f.id>? AND {WINDOW}"
        )];
        for (column, ids) in [
            ("f.layer_id", &query.layer_ids),
            ("f.id", &query.feature_ids),
        ] {
            if let Some(ids) = ids {
                if ids.is_empty() {
                    return Ok(Vec::new());
                }
                clauses.push(format!("{column} IN ({})", placeholders(ids.len())));
                values.extend(ids.iter().cloned().map(Value::Text));
            }
        }
        if let Some(text) = query.text.as_ref().filter(|text| !text.is_empty()) {
            clauses.push("instr(lower(coalesce(f.name,'')),lower(?))>0".into());
            values.push(text.clone().into());
        }
        values.push(((PAGE_SIZE + 1) as i64).into());
        // Catalogue bounds hold a feature's geometry and footprint together.
        let index = if query.footprints {
            "map_catalog_bounds"
        } else {
            "map_feature_bounds"
        };
        self.db.query(&format!("SELECT f.* FROM map_features f JOIN {index} b ON b.row_id=f.row_id WHERE {} ORDER BY f.id LIMIT ?", clauses.join(" AND ")), &values)
    }
    pub fn entities(&self, reference: &MapRef, ids: &[String]) -> io::Result<Vec<MapEntity>> {
        self.open(reference)?;
        let mut items = Vec::new();
        for id in ids.iter().collect::<BTreeSet<_>>() {
            let mut values = reference_values(reference);
            values.push(id.clone().into());
            if let Some(bytes) = self.db.value(
                "SELECT data FROM map_entities WHERE map_id=? AND revision=? AND id=?",
                &values,
            )? {
                items.push(codec::decode(bytes.bytes()?)?);
            }
        }
        Ok(items)
    }
    pub fn history(
        &self,
        reference: &MapRef,
        after: &str,
        feature_ids: Option<&[String]>,
    ) -> io::Result<Page<HistoryEntry>> {
        self.open(reference)?;
        if feature_ids.is_some_and(|ids| ids.is_empty()) {
            return Ok(Page {
                items: Vec::new(),
                next: None,
            });
        }
        let mut values = reference_values(reference);
        values.push(after.into());
        let predicate = feature_ids.map_or_else(String::new, |ids| {
            values.extend(ids.iter().cloned().map(Value::Text));
            format!(" AND EXISTS(SELECT 1 FROM map_history_features f WHERE f.map_id=h.map_id AND f.revision=h.revision AND f.history_id=h.id AND f.feature_id IN ({}))", placeholders(ids.len()))
        });
        values.push(((PAGE_SIZE + 1) as i64).into());
        let rows = self.db.query(&format!("SELECT h.data FROM map_history h WHERE h.map_id=? AND h.revision=? AND h.id>?{predicate} ORDER BY h.id LIMIT ?"), &values)?;
        let more = rows.len() > PAGE_SIZE;
        let items: Vec<HistoryEntry> = rows
            .iter()
            .take(PAGE_SIZE)
            .map(|row| codec::decode(column(row, "data")?.bytes()?))
            .collect::<io::Result<_>>()?;
        let next = more
            .then(|| items.last().map(|item| item.id.clone()))
            .flatten();
        Ok(Page { items, next })
    }
    pub(super) fn feature(&self, row: &Row) -> io::Result<MapFeature> {
        let mut value: serde_json::Value = codec::decode(column(row, "data")?.bytes()?)?;
        value["geometry"] =
            serde_json::to_value(self.geometry.decode(column(row, "geometry")?.bytes()?)?)
                .map_err(io::Error::other)?;
        serde_json::from_value(value).map_err(io::Error::other)
    }
}
pub(super) fn placeholders(count: usize) -> String {
    vec!["?"; count].join(",")
}
