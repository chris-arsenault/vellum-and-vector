use super::{features::FEATURE_COLUMNS, from_json, uuid, uuids, Params, PostgresMaps};
use crate::{
    map_store::{
        samples::{canonical_position, owns},
        space, FeatureQuery, Page,
    },
    rows::SampleRow,
};
use atlas_map::{
    regions::as_region, Bounds, HistoryEntry, Id, MapEntity, MapFeature, MapRef, MapSample,
    Position, PublishedAsset,
};
use postgres::Row;
use std::io;
const PAGE_SIZE: usize = 256;
impl PostgresMaps {
    pub fn asset(&self, r: &MapRef, asset_id: &str) -> io::Result<PublishedAsset> {
        let row = self
            .query(
                "SELECT * FROM map.assets WHERE map_id=$1 AND revision=$2 AND id=$3",
                &[&uuid(r.map_id), &uuid(r.revision), &asset_id],
            )?
            .into_iter()
            .next()
            .ok_or_else(|| io::Error::other("Map asset was not found"))?;
        asset(&row)
    }
    pub fn illustration_assets(&self, r: &MapRef) -> io::Result<Vec<PublishedAsset>> {
        self.query(
            "SELECT * FROM map.assets WHERE map_id=$1 AND revision=$2 AND illustration ORDER BY id",
            &[&uuid(r.map_id), &uuid(r.revision)],
        )?
        .iter()
        .map(asset)
        .collect()
    }
    pub fn entities(&self, r: &MapRef, ids: &[Id]) -> io::Result<Vec<MapEntity>> {
        self.query(
            "SELECT data FROM map.entities WHERE map_id=$1 AND revision=$2 AND id=ANY($3) ORDER BY id",
            &[&uuid(r.map_id), &uuid(r.revision), &uuids(ids)],
        )?
        .iter()
        .map(|row| from_json(row.try_get("data").map_err(io::Error::other)?))
        .collect()
    }
    pub fn features(&self, r: &MapRef, query: &FeatureQuery) -> io::Result<Page<MapFeature>> {
        let space = self.read_space(r, query.space_id)?;
        let (clauses, mut params) = self.conditions(r, query, space.bounds, space.precision)?;
        let limit = params.bind((PAGE_SIZE + 1) as i64);
        let rows = self.query(
            &format!(
                "SELECT {FEATURE_COLUMNS} FROM map.features f WHERE {} ORDER BY f.id LIMIT {limit}",
                clauses.join(" AND ")
            ),
            &params.values(),
        )?;
        let items = self.features_from(&rows[..rows.len().min(PAGE_SIZE)])?;
        let next = (rows.len() > PAGE_SIZE)
            .then(|| items.last().map(|f| f.id))
            .flatten();
        Ok(Page { items, next })
    }
    pub fn samples_at(
        &self,
        r: &MapRef,
        space_id: Id,
        position: Position,
    ) -> io::Result<Vec<MapSample>> {
        let map = self.open(r)?;
        let space = space(&map, space_id)?;
        let position = canonical_position(space, position)?;
        let [x, y, _] = position.coordinates();
        let rows = self.query(
            "SELECT id,space_id,ST_AsBinary(geometry) AS geometry,window_west,window_south,
             window_east,window_north,closed_east,closed_north,cell_span,center_x,center_y,
             center_z,measure,active,sections FROM map.samples
             WHERE map_id=$1 AND revision=$2 AND space_id=$3
             AND ST_Covers(geometry,ST_SetSRID(ST_MakePoint($4,$5),0)) ORDER BY id",
            &[&uuid(r.map_id), &uuid(r.revision), &uuid(space_id), &x, &y],
        )?;
        let mut samples = Vec::new();
        for row in rows {
            let get = |name: &str| row.try_get::<_, f64>(name).map_err(io::Error::other);
            let flag = |name: &str| row.try_get::<_, bool>(name).map_err(io::Error::other);
            let shape: Vec<u8> = row.try_get("geometry").map_err(io::Error::other)?;
            let footprint = as_region(self.geometry.decode(&shape)?).map_err(io::Error::other)?;
            let sample = SampleRow {
                id: row.try_get("id").map_err(io::Error::other)?,
                space_id: super::id(row.try_get("space_id").map_err(io::Error::other)?),
                window: Bounds(
                    get("window_west")?,
                    get("window_south")?,
                    get("window_east")?,
                    get("window_north")?,
                ),
                closed_east: flag("closed_east")?,
                closed_north: flag("closed_north")?,
                cell_span: get("cell_span")?,
                center: [get("center_x")?, get("center_y")?],
                center_z: row.try_get("center_z").map_err(io::Error::other)?,
                measure: get("measure")?,
                active: flag("active")?,
                sections: row.try_get("sections").map_err(io::Error::other)?,
            }
            .sample(footprint)?;
            if owns(&sample.window, space, position) {
                samples.push(sample);
            }
        }
        Ok(samples)
    }
    pub fn history(
        &self,
        r: &MapRef,
        cursor: Option<Id>,
        ids: Option<&[Id]>,
    ) -> io::Result<Page<HistoryEntry>> {
        let mut params = Params::default();
        params.bind(uuid(r.map_id));
        params.bind(uuid(r.revision));
        params.bind(uuid(cursor.unwrap_or(Id::NIL)));
        params.bind((PAGE_SIZE + 1) as i64);
        let predicate = ids
            .map(|ids| {
                format!(
                    " AND EXISTS(SELECT 1 FROM map.history_features f WHERE f.map_id=h.map_id AND f.revision=h.revision AND f.history_id=h.id AND f.feature_id=ANY({}))",
                    params.bind(uuids(ids))
                )
            })
            .unwrap_or_default();
        let rows = self.query(
            &format!("SELECT data FROM map.history h WHERE map_id=$1 AND revision=$2 AND id>$3{predicate} ORDER BY id LIMIT $4"),
            &params.values(),
        )?;
        let items: Vec<HistoryEntry> = rows
            .iter()
            .take(PAGE_SIZE)
            .map(|row| from_json(row.try_get("data").map_err(io::Error::other)?))
            .collect::<io::Result<_>>()?;
        let next = (rows.len() > PAGE_SIZE)
            .then(|| items.last().map(|e| e.id))
            .flatten();
        Ok(Page { items, next })
    }
    fn conditions(
        &self,
        r: &MapRef,
        query: &FeatureQuery,
        whole: Bounds,
        precision: f64,
    ) -> io::Result<(Vec<String>, Params)> {
        let mut params = Params::default();
        params.bind(uuid(r.map_id));
        params.bind(uuid(r.revision));
        params.bind(uuid(query.space_id));
        params.bind(uuid(query.cursor.unwrap_or(Id::NIL)));
        let mut clauses = vec![
            "f.map_id=$1".into(),
            "f.revision=$2".into(),
            "f.space_id=$3".into(),
            "f.id>$4".into(),
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
            clauses.push(if query.footprints {
                format!("(f.geometry && ST_MakeEnvelope({args},0) OR f.footprint && ST_MakeEnvelope({args},0))")
            } else {
                format!("f.geometry && ST_MakeEnvelope({args},0)")
            });
        }
        if let Some(shape) = &query.geometry {
            let wkb = self.wkb(shape, precision)?;
            clauses.push(format!(
                "ST_Intersects(f.geometry,ST_GeomFromWKB({},0))",
                params.bind(wkb)
            ));
        }
        if let Some(layers) = &query.layer_ids {
            clauses.push(format!("f.layer_id=ANY({})", params.bind(layers.clone())));
        }
        if let Some(ids) = &query.feature_ids {
            clauses.push(format!("f.id=ANY({})", params.bind(uuids(ids))));
        }
        if let Some(text) = query.text.as_ref().filter(|s| !s.is_empty()) {
            clauses.push(format!(
                "strpos(lower(coalesce(f.name,'')),lower({}))>0",
                params.bind(text.clone())
            ));
        }
        Ok((clauses, params))
    }
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
