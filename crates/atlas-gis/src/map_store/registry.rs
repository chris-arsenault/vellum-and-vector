use super::{
    records::region_geometry,
    reference_values,
    registry_query::{path, where_query, RegistryQuery},
    space, MapStore,
};
use crate::sql::{column, Value};
use atlas_map::{
    regions::rectangle, spatial::Predicate, Bounds, MapColumn, MapFeature, MapFeatureType, MapRef,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io};
const SELECTION: &str = "map_feature_catalog c JOIN map_features f USING(row_id) JOIN map_registry_visible v USING(row_id)";
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    Map,
    World,
}
#[derive(Serialize, Deserialize)]
pub struct Sort {
    pub key: String,
    pub descending: bool,
}
#[derive(Serialize, Deserialize)]
pub struct RegistryRequest {
    pub scope: Scope,
    pub bounds: Option<Bounds>,
    pub query: RegistryQuery,
    pub sort: Sort,
    pub page: u64,
    pub limit: u64,
}
#[derive(Serialize, Deserialize)]
pub struct RegistryRow {
    pub reference: MapRef,
    pub feature: MapFeature,
    #[serde(rename = "type")]
    pub kind: MapFeatureType,
    pub values: BTreeMap<String, serde_json::Value>,
}
#[derive(Serialize, Deserialize)]
pub struct Facets {
    pub types: Vec<MapFeatureType>,
    pub categories: BTreeMap<String, Vec<String>>,
}
#[derive(Serialize, Deserialize)]
pub struct RegistryPage {
    pub rows: Vec<RegistryRow>,
    pub total: u64,
    pub matching: u64,
    pub page: u64,
    pub columns: Vec<MapColumn>,
    pub facets: Facets,
}
impl MapStore {
    pub fn registry(
        &self,
        reference: &MapRef,
        request: &RegistryRequest,
    ) -> io::Result<RegistryPage> {
        if request.limit == 0
            || request.limit > 9_007_199_254_740_991
            || request.page > 9_007_199_254_740_991
        {
            return Err(io::Error::other("Choose a valid registry page"));
        }
        self.registry_visible(reference, request)?;
        let (predicate, mut bind) = where_query(&request.query)?;
        let count = |sql: &str, values: &[Value]| -> io::Result<u64> {
            u64::try_from(
                self.db
                    .value(sql, values)?
                    .ok_or_else(|| io::Error::other("Missing registry count"))?
                    .integer()?,
            )
            .map_err(io::Error::other)
        };
        let total = count(&format!("SELECT count(*) FROM {SELECTION}"), &[])?;
        let matching = count(
            &format!("SELECT count(*) FROM {SELECTION} WHERE {predicate}"),
            &bind,
        )?;
        let page = request
            .page
            .min(matching.div_ceil(request.limit).saturating_sub(1));
        let key = path(&request.sort.key);
        let direction = if request.sort.descending {
            "DESC"
        } else {
            "ASC"
        };
        bind.extend([
            key.clone().into(),
            key.clone().into(),
            key.into(),
            (request.limit as i64).into(),
            i64::try_from(page * request.limit)
                .map_err(io::Error::other)?
                .into(),
        ]);
        let records = self.db.query(&format!("SELECT f.*,c.type,c.values_json FROM {SELECTION} WHERE {predicate} ORDER BY (json_extract(c.values_json,?) IS NULL OR json_extract(c.values_json,?)=''),json_extract(c.values_json,?) COLLATE NOCASE {direction},f.map_id,f.id LIMIT ? OFFSET ?"),&bind)?;
        let rows = records
            .iter()
            .map(|row| {
                Ok(RegistryRow {
                    reference: MapRef {
                        map_id: column(row, "map_id")?.text()?.into(),
                        revision: column(row, "revision")?.text()?.into(),
                    },
                    feature: self.feature(row)?,
                    kind: serde_json::from_str(column(row, "type")?.text()?)
                        .map_err(io::Error::other)?,
                    values: serde_json::from_str(column(row, "values_json")?.text()?)
                        .map_err(io::Error::other)?,
                })
            })
            .collect::<io::Result<_>>()?;
        Ok(RegistryPage {
            rows,
            total,
            matching,
            page,
            columns: self.registry_columns()?,
            facets: self.registry_facets()?,
        })
    }
    fn registry_visible(&self, reference: &MapRef, request: &RegistryRequest) -> io::Result<()> {
        let map = self.open(reference)?;
        self.db.batch("CREATE TEMP TABLE IF NOT EXISTS map_registry_visible(row_id INTEGER PRIMARY KEY); DELETE FROM map_registry_visible;")?;
        let mut scope = "(f.map_id=? AND f.revision=?)".to_owned();
        let mut bind = reference_values(reference);
        if matches!(request.scope, Scope::World) {
            scope.push_str(" OR (f.map_id<>? AND json_extract(m.descriptor,'$.worldId')=? AND EXISTS(SELECT 1 FROM map_heads h WHERE h.map_id=f.map_id AND h.revision=f.revision))");
            bind.extend([reference.map_id.clone().into(), map.world_id.into()]);
        }
        let Some(bounds) = request.bounds else {
            self.db.execute(&format!("INSERT INTO map_registry_visible SELECT f.row_id FROM map_features f JOIN maps m USING(map_id,revision) WHERE {scope}"),&bind)?;
            return Ok(());
        };
        bounds.validate_window().map_err(io::Error::other)?;
        let Bounds(w, s, e, n) = bounds;
        bind.extend([e.into(), w.into(), n.into(), s.into()]);
        let candidates = self.db.query(&format!("SELECT f.* FROM map_features f JOIN maps m USING(map_id,revision) JOIN map_catalog_bounds b USING(row_id) WHERE ({scope}) AND b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?"),&bind)?;
        let geometry = rectangle(bounds);
        for row in candidates {
            let feature = self.feature(&row)?;
            let owner = self.open(&MapRef {
                map_id: column(&row, "map_id")?.text()?.into(),
                revision: column(&row, "revision")?.text()?.into(),
            })?;
            let kernel = self
                .geometry
                .spatial(space(&owner, &feature.space_id)?.precision)?;
            let intersects = kernel
                .relation(&feature.geometry, &geometry, Predicate::Intersects)
                .map_err(io::Error::other)?
                || match feature.footprint {
                    Some(shape) => kernel
                        .relation(&region_geometry(&shape), &geometry, Predicate::Intersects)
                        .map_err(io::Error::other)?,
                    None => false,
                };
            if intersects {
                self.db.execute(
                    "INSERT INTO map_registry_visible VALUES(?)",
                    &[column(&row, "row_id")?.clone()],
                )?;
            }
        }
        Ok(())
    }
    fn registry_columns(&self) -> io::Result<Vec<MapColumn>> {
        self.db.query(&format!("SELECT json_extract(j.value,'$.key') AS key,json_extract(j.value,'$.label') AS label,max(json_extract(j.value,'$.numeric')) AS numeric FROM {SELECTION},json_each(c.columns_json) j GROUP BY json_extract(j.value,'$.key') ORDER BY min(CAST(j.key AS INTEGER)),key"),&[])?.iter().map(|row| Ok(MapColumn {key:column(row,"key")?.text()?.into(),label:column(row,"label")?.text()?.into(),numeric:column(row,"numeric")?.integer()? != 0})).collect()
    }
    fn registry_facets(&self) -> io::Result<Facets> {
        let mut categories = BTreeMap::new();
        for key in ["status", "state", "profile", "space"] {
            let rows = self.db.query(&format!("SELECT DISTINCT json_extract(c.values_json,?) AS value FROM {SELECTION} WHERE value IS NOT NULL AND value<>'' ORDER BY value"),&[path(key).into()])?;
            categories.insert(
                key.into(),
                rows.iter()
                    .map(|row| column(row, "value")?.text().map(String::from))
                    .collect::<io::Result<_>>()?,
            );
        }
        let types = self
            .db
            .query(
                &format!("SELECT DISTINCT c.type FROM {SELECTION} ORDER BY c.type"),
                &[],
            )?
            .iter()
            .map(|row| serde_json::from_str(column(row, "type")?.text()?).map_err(io::Error::other))
            .collect::<io::Result<_>>()?;
        Ok(Facets { types, categories })
    }
}
