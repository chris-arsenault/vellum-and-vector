use super::{from_json, Params, PostgresMaps};
use crate::map_store::{
    codec,
    samples::{canonical_position, owns},
    space, FeatureQuery, Page,
};
use atlas_map::{
    Bounds, HistoryEntry, MapEntity, MapFeature, MapRef, MapSample, Position, PublishedAsset,
};
use postgres::Row;
use std::io;
const PAGE_SIZE: usize = 256;
impl PostgresMaps {
    pub fn asset(&self, r: &MapRef, id: &str) -> io::Result<PublishedAsset> {
        let row = self
            .query(
                "SELECT * FROM map.assets WHERE map_id=$1 AND revision=$2 AND id=$3",
                &[&r.map_id, &r.revision, &id],
            )?
            .into_iter()
            .next()
            .ok_or_else(|| io::Error::other("Map asset was not found"))?;
        asset(&row)
    }
    pub fn illustration_assets(&self, r: &MapRef) -> io::Result<Vec<PublishedAsset>> {
        self.open(r)?;
        self.query(
            "SELECT * FROM map.assets WHERE map_id=$1 AND revision=$2 AND illustration ORDER BY id",
            &[&r.map_id, &r.revision],
        )?
        .iter()
        .map(asset)
        .collect()
    }
    pub fn entities(&self, r: &MapRef, ids: &[String]) -> io::Result<Vec<MapEntity>> {
        self.open(r)?;
        self.query("SELECT data FROM map.entities WHERE map_id=$1 AND revision=$2 AND id=ANY($3::text[]) ORDER BY id",&[&r.map_id,&r.revision,&ids])?.iter().map(|row|from_json(row.try_get("data").map_err(io::Error::other)?)).collect()
    }
    pub fn features(&self, r: &MapRef, query: &FeatureQuery) -> io::Result<Page<MapFeature>> {
        let map = self.open(r)?;
        let space = space(&map, &query.space_id)?;
        let (clauses, mut params) = conditions(r, query, space.bounds)?;
        let limit = params.bind((PAGE_SIZE + 1) as i64);
        let rows=self.query(&format!("SELECT data,ST_AsGeoJSON(geometry,15,0)::json AS geometry FROM map.features WHERE {} ORDER BY id LIMIT {limit}",clauses.join(" AND ")),&params.values())?;
        let items = rows
            .iter()
            .take(PAGE_SIZE)
            .map(feature)
            .collect::<io::Result<Vec<_>>>()?;
        let next = (rows.len() > PAGE_SIZE)
            .then(|| items.last().map(|f| f.id.clone()))
            .flatten();
        Ok(Page { items, next })
    }
    pub fn samples_at(
        &self,
        r: &MapRef,
        space_id: &str,
        position: Position,
    ) -> io::Result<Vec<MapSample>> {
        let map = self.open(r)?;
        let space = space(&map, space_id)?;
        let position = canonical_position(space, position)?;
        let [x, y, _] = position.coordinates();
        let rows=self.query("SELECT data,ST_AsGeoJSON(geometry,15,0)::json AS geometry FROM map.samples WHERE map_id=$1 AND revision=$2 AND space_id=$3 AND ST_Covers(geometry,ST_SetSRID(ST_MakePoint($4,$5),0)) ORDER BY id",&[&r.map_id,&r.revision,&space_id,&x,&y])?;
        let encoding = codec::Samples::new(&map);
        let mut samples = Vec::new();
        for row in rows {
            let sample = encoding.decode(
                row.try_get::<_, &[u8]>("data").map_err(io::Error::other)?,
                from_json(row.try_get("geometry").map_err(io::Error::other)?)?,
            )?;
            if owns(&sample.window, space, position) {
                samples.push(sample);
            }
        }
        Ok(samples)
    }
    pub fn history(
        &self,
        r: &MapRef,
        cursor: &str,
        ids: Option<&[String]>,
    ) -> io::Result<Page<HistoryEntry>> {
        self.open(r)?;
        let mut params = Params::default();
        params.bind(r.map_id.clone());
        params.bind(r.revision.clone());
        params.bind(cursor.to_owned());
        params.bind((PAGE_SIZE + 1) as i64);
        let predicate=ids.map(|ids|format!(" AND EXISTS(SELECT 1 FROM map.history_features f WHERE f.map_id=h.map_id AND f.revision=h.revision AND f.history_id=h.id AND f.feature_id=ANY({}::text[]))",params.bind(ids.to_vec()))).unwrap_or_default();
        let rows=self.query(&format!("SELECT data FROM map.history h WHERE map_id=$1 AND revision=$2 AND id>$3{predicate} ORDER BY id LIMIT $4"),&params.values())?;
        let items: Vec<HistoryEntry> = rows
            .iter()
            .take(PAGE_SIZE)
            .map(|row| from_json(row.try_get("data").map_err(io::Error::other)?))
            .collect::<io::Result<_>>()?;
        let next = (rows.len() > PAGE_SIZE)
            .then(|| items.last().map(|e| e.id.clone()))
            .flatten();
        Ok(Page { items, next })
    }
}
pub(super) fn feature(row: &Row) -> io::Result<MapFeature> {
    let mut data: serde_json::Value = row.try_get("data").map_err(io::Error::other)?;
    data["geometry"] = row.try_get("geometry").map_err(io::Error::other)?;
    from_json(data)
}
fn asset(row: &Row) -> io::Result<PublishedAsset> {
    Ok(PublishedAsset {
        id: row.try_get("id").map_err(io::Error::other)?,
        media_type: row.try_get("media_type").map_err(io::Error::other)?,
        location: row.try_get("location").map_err(io::Error::other)?,
        byte_length: u64::try_from(
            row.try_get::<_, i64>("byte_length")
                .map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?,
        illustration: row.try_get("illustration").map_err(io::Error::other)?,
    })
}
fn conditions(
    r: &MapRef,
    query: &FeatureQuery,
    whole: Bounds,
) -> io::Result<(Vec<String>, Params)> {
    let mut params = Params::default();
    params.bind(r.map_id.clone());
    params.bind(r.revision.clone());
    params.bind(query.space_id.clone());
    params.bind(query.cursor.clone().unwrap_or_default());
    let mut clauses = vec![
        "map_id=$1".into(),
        "revision=$2".into(),
        "space_id=$3".into(),
        "id>$4".into(),
    ];
    if query.bounds.is_some() || query.geometry.is_none() {
        let bounds = query.bounds.unwrap_or(whole);
        bounds.validate_window().map_err(io::Error::other)?;
        let Bounds(w, s, e, n) = bounds;
        let args = [w, s, e, n]
            .into_iter()
            .map(|v| params.bind(v))
            .collect::<Vec<_>>()
            .join(",");
        clauses.push(format!("geometry && ST_MakeEnvelope({args},0)"));
    }
    if let Some(shape) = &query.geometry {
        clauses.push(format!(
            "ST_Intersects(geometry,ST_SetSRID(ST_GeomFromGeoJSON({}),0))",
            params.bind(serde_json::to_string(shape)?)
        ));
    }
    for (field, ids) in [("layer_id", &query.layer_ids), ("id", &query.feature_ids)] {
        if let Some(ids) = ids {
            clauses.push(format!("{field}=ANY({}::text[])", params.bind(ids.clone())));
        }
    }
    if let Some(text) = query.text.as_ref().filter(|s| !s.is_empty()) {
        clauses.push(format!(
            "strpos(lower(coalesce(name,'')),lower({}))>0",
            params.bind(text.clone())
        ));
    }
    Ok((clauses, params))
}
