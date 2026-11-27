use super::{codec, description::key, MapStore};
use crate::sql::{column, Row, Value};
use atlas_map::{
    spatial::Predicate, Bounds, Geometry, HistoryEntry, Id, MapEntity, MapFeature, MapRef,
    PublishedAsset,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, io};

pub(super) const PAGE_SIZE: usize = 256;
pub(super) const WINDOW: &str = "b.max_x>=? AND b.min_x<=? AND b.max_y>=? AND b.min_y<=?";
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureQuery {
    pub space_id: Id,
    pub bounds: Option<Bounds>,
    pub geometry: Option<Geometry>,
    pub feature_ids: Option<Vec<Id>>,
    pub layer_ids: Option<Vec<String>>,
    pub type_ids: Option<Vec<String>>,
    pub text: Option<String>,
    pub cursor: Option<Id>,
    /// Bounds meet a feature's footprint as well as its geometry, as hex marks do.
    #[serde(default)]
    pub footprints: bool,
}
#[derive(Serialize, Deserialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next: Option<Id>,
}
impl MapStore {
    pub fn asset(&self, reference: &MapRef, id: &str) -> io::Result<PublishedAsset> {
        let mut values = key(reference);
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
            illustration: column(&row, "illustration")?.flag()?,
        })
    }
    pub fn illustration_assets(&self, reference: &MapRef) -> io::Result<Vec<PublishedAsset>> {
        self.db
            .query(
                "SELECT id FROM map_assets WHERE map_id=? AND revision=? AND illustration=1 ORDER BY id",
                &key(reference),
            )?
            .iter()
            .map(|row| self.asset(reference, column(row, "id")?.text()?))
            .collect()
    }
    pub fn features(
        &self,
        reference: &MapRef,
        query: &FeatureQuery,
    ) -> io::Result<Page<MapFeature>> {
        let space = self.read_space(reference, query.space_id)?;
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
        let selected = &rows[..rows.len().min(PAGE_SIZE)];
        let next = if has_more {
            selected
                .last()
                .map(|row| column(row, "id")?.id())
                .transpose()?
        } else {
            None
        };
        let kernel = self.geometry.spatial(space.precision)?;
        let mut items = Vec::new();
        for feature in self.features_from(selected)? {
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
        let mut values = key(reference);
        values.extend([
            query.space_id.into(),
            query.cursor.unwrap_or(Id::NIL).into(),
        ]);
        let window: [Value; 4] = [w.into(), e.into(), s.into(), n.into()];
        // A feature meets the window by its geometry, or by its footprint when asked.
        let within = if query.footprints {
            values.extend(window.clone());
            values.extend(window);
            format!("f.row_id IN (SELECT row_id FROM map_feature_bounds b WHERE {WINDOW} UNION SELECT row_id FROM map_footprint_bounds b WHERE {WINDOW})")
        } else {
            values.extend(window);
            format!("f.row_id IN (SELECT row_id FROM map_feature_bounds b WHERE {WINDOW})")
        };
        let mut clauses = vec![format!(
            "f.map_id=? AND f.revision=? AND f.space_id=? AND f.id>? AND {within}"
        )];
        for (column, ids) in [("layer_id", &query.layer_ids), ("type_id", &query.type_ids)] {
            let Some(ids) = ids else { continue };
            if ids.is_empty() {
                return Ok(Vec::new());
            }
            clauses.push(format!("f.{column} IN ({})", placeholders(ids.len())));
            values.extend(ids.iter().cloned().map(Value::Text));
        }
        if let Some(ids) = &query.feature_ids {
            if ids.is_empty() {
                return Ok(Vec::new());
            }
            clauses.push(format!("f.id IN ({})", placeholders(ids.len())));
            values.extend(ids.iter().copied().map(Value::from));
        }
        if let Some(text) = query.text.as_ref().filter(|text| !text.is_empty()) {
            clauses.push("instr(lower(coalesce(f.name,'')),lower(?))>0".into());
            values.push(text.clone().into());
        }
        values.push(((PAGE_SIZE + 1) as i64).into());
        self.db.query(
            &format!(
                "SELECT f.* FROM map_features f WHERE {} ORDER BY f.id LIMIT ?",
                clauses.join(" AND ")
            ),
            &values,
        )
    }
    pub fn entities(&self, reference: &MapRef, ids: &[Id]) -> io::Result<Vec<MapEntity>> {
        let mut items = Vec::new();
        for &id in ids.iter().collect::<BTreeSet<_>>() {
            let mut values = key(reference);
            values.push(id.into());
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
        after: Option<Id>,
        feature_ids: Option<&[Id]>,
    ) -> io::Result<Page<HistoryEntry>> {
        if feature_ids.is_some_and(|ids| ids.is_empty()) {
            return Ok(Page {
                items: Vec::new(),
                next: None,
            });
        }
        // Entries come in published order; a page continues after the entry it ended on.
        let mut values = key(reference);
        values.extend(key(reference));
        values.push(after.unwrap_or(Id::NIL).into());
        let predicate = feature_ids.map_or_else(String::new, |ids| {
            values.extend(ids.iter().copied().map(Value::from));
            format!(" AND EXISTS(SELECT 1 FROM map_history_features f WHERE f.map_id=h.map_id AND f.revision=h.revision AND f.history_id=h.id AND f.feature_id IN ({}))", placeholders(ids.len()))
        });
        values.push(((PAGE_SIZE + 1) as i64).into());
        let rows = self.db.query(&format!("SELECT h.data FROM map_history h WHERE h.map_id=? AND h.revision=?
             AND h.ordinal>COALESCE((SELECT ordinal FROM map_history WHERE map_id=? AND revision=? AND id=?),-1){predicate}
             ORDER BY h.ordinal LIMIT ?"), &values)?;
        let more = rows.len() > PAGE_SIZE;
        let items: Vec<HistoryEntry> = rows
            .iter()
            .take(PAGE_SIZE)
            .map(|row| codec::decode(column(row, "data")?.bytes()?))
            .collect::<io::Result<_>>()?;
        let next = more.then(|| items.last().map(|item| item.id)).flatten();
        Ok(Page { items, next })
    }
}
pub(super) fn placeholders(count: usize) -> String {
    vec!["?"; count].join(",")
}
