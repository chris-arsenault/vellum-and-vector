use super::{
    description::{feature_type_row, key},
    registry_query::{path, where_query, RegistryQuery},
    MapStore,
};
use crate::sql::{column, Value};
use atlas_map::{
    regions::{as_geometry, rectangle},
    spatial::Predicate,
    Bounds, MapColumn, MapFeature, MapFeatureType, MapRef,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io};
/// The visible features with their layer and feature type rows.
const SELECTION: &str = "map_features f JOIN map_registry_visible v USING(row_id)
 JOIN map_layers l ON l.map_id=f.map_id AND l.revision=f.revision AND l.id=f.layer_id
 JOIN map_feature_types t ON t.map_id=f.map_id AND t.revision=f.revision AND t.layer=l.ordinal AND t.id=f.type_id";
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
        let records = self.db.query(&format!("SELECT f.*,t.layer AS type_layer,t.ordinal AS type_ordinal FROM {SELECTION} WHERE {predicate} ORDER BY (json_extract(f.catalog,?) IS NULL OR json_extract(f.catalog,?)=''),json_extract(f.catalog,?) COLLATE NOCASE {direction},f.map_id,f.id LIMIT ? OFFSET ?"),&bind)?;
        let features = self.features_from(&records)?;
        let rows = records
            .iter()
            .zip(features)
            .map(|(row, feature)| {
                let values = feature.catalog.values.clone();
                Ok(RegistryRow {
                    reference: MapRef {
                        map_id: column(row, "map_id")?.id()?,
                        revision: column(row, "revision")?.id()?,
                    },
                    kind: self.feature_type_at(row)?,
                    feature,
                    values,
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
    /// The feature type a selected row names by its map, revision, layer and ordinal.
    fn feature_type_at(&self, row: &crate::sql::Row) -> io::Result<MapFeatureType> {
        let found = self
            .db
            .query(
                "SELECT * FROM map_feature_types WHERE map_id=? AND revision=? AND layer=? AND ordinal=?",
                &[
                    column(row, "map_id")?.clone(),
                    column(row, "revision")?.clone(),
                    column(row, "type_layer")?.clone(),
                    column(row, "type_ordinal")?.clone(),
                ],
            )?
            .into_iter()
            .next()
            .ok_or_else(|| io::Error::other("A feature's type is not on its layer"))?;
        Ok(feature_type_row(&found)?.feature_type)
    }
    fn registry_visible(&self, reference: &MapRef, request: &RegistryRequest) -> io::Result<()> {
        self.db.batch("CREATE TEMP TABLE IF NOT EXISTS map_registry_visible(row_id INTEGER PRIMARY KEY); DELETE FROM map_registry_visible;")?;
        let mut scope = "(f.map_id=? AND f.revision=?)".to_owned();
        let mut bind = key(reference);
        if matches!(request.scope, Scope::World) {
            let world = self
                .db
                .value(
                    "SELECT world_id FROM maps WHERE map_id=? AND revision=?",
                    &key(reference),
                )?
                .ok_or_else(|| io::Error::other("Map revision was not found"))?;
            scope.push_str(" OR (f.map_id<>? AND m.world_id=? AND EXISTS(SELECT 1 FROM map_heads h WHERE h.map_id=f.map_id AND h.revision=f.revision))");
            bind.extend([reference.map_id.into(), world]);
        }
        let Some(bounds) = request.bounds else {
            self.db.execute(&format!("INSERT INTO map_registry_visible SELECT f.row_id FROM map_features f JOIN maps m USING(map_id,revision) WHERE {scope}"),&bind)?;
            return Ok(());
        };
        bounds.validate_window().map_err(io::Error::other)?;
        let Bounds(w, s, e, n) = bounds;
        let window = [e.into(), w.into(), n.into(), s.into()];
        let mut values = bind.clone();
        values.extend(window.clone());
        values.extend(bind);
        values.extend(window);
        let near = "b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?";
        let candidates = self.db.query(
            &format!("SELECT f.* FROM map_features f JOIN maps m USING(map_id,revision) JOIN map_feature_bounds b USING(row_id) WHERE ({scope}) AND {near}
             UNION SELECT f.* FROM map_features f JOIN maps m USING(map_id,revision) JOIN map_footprint_bounds b USING(row_id) WHERE ({scope}) AND {near}"),
            &values,
        )?;
        let geometry = rectangle(bounds);
        let features = self.features_from(&candidates)?;
        for (row, feature) in candidates.iter().zip(features) {
            let owner = MapRef {
                map_id: column(row, "map_id")?.id()?,
                revision: column(row, "revision")?.id()?,
            };
            let precision = self.read_space(&owner, feature.space_id)?.precision;
            let kernel = self.geometry.spatial(precision)?;
            let intersects = kernel
                .relation(&feature.geometry, &geometry, Predicate::Intersects)
                .map_err(io::Error::other)?
                || match &feature.footprint {
                    Some(shape) => kernel
                        .relation(&as_geometry(shape), &geometry, Predicate::Intersects)
                        .map_err(io::Error::other)?,
                    None => false,
                };
            if intersects {
                self.db.execute(
                    "INSERT OR IGNORE INTO map_registry_visible VALUES(?)",
                    &[column(row, "row_id")?.clone()],
                )?;
            }
        }
        Ok(())
    }
    fn registry_columns(&self) -> io::Result<Vec<MapColumn>> {
        // The columns of the values the visible features hold, in their maps' column order.
        let sql = format!(
            "SELECT c.key,min(c.label) AS label,max(c.numeric) AS numeric
             FROM {SELECTION},json_each(f.catalog,'$.values') j
             JOIN map_registry_columns c ON c.map_id=f.map_id AND c.revision=f.revision AND c.key=j.key
             GROUP BY c.key ORDER BY min(c.ordinal),c.key"
        );
        self.db
            .query(&sql, &[])?
            .iter()
            .map(|row| {
                Ok(MapColumn {
                    key: column(row, "key")?.text()?.into(),
                    label: column(row, "label")?.text()?.into(),
                    numeric: column(row, "numeric")?.flag()?,
                })
            })
            .collect()
    }
    fn registry_facets(&self) -> io::Result<Facets> {
        let mut categories = BTreeMap::new();
        for key in ["status", "state", "profile", "space"] {
            let rows = self.db.query(&format!("SELECT DISTINCT json_extract(f.catalog,?) AS value FROM {SELECTION} WHERE value IS NOT NULL AND value<>'' ORDER BY value"),&[path(key).into()])?;
            categories.insert(
                key.into(),
                rows.iter()
                    .map(|row| column(row, "value")?.text().map(String::from))
                    .collect::<io::Result<_>>()?,
            );
        }
        let mut types = self
            .db
            .query(&format!("SELECT DISTINCT t.* FROM {SELECTION}"), &[])?
            .iter()
            .map(|row| feature_type_row(row).map(|t| t.feature_type))
            .collect::<io::Result<Vec<_>>>()?;
        types.sort_by(|a, b| a.id.cmp(&b.id).then(a.path.cmp(&b.path)));
        types.dedup();
        Ok(Facets { types, categories })
    }
}
