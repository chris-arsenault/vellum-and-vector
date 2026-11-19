use super::{
    description::{feature_type_row, get},
    features::FEATURE_COLUMNS,
    id,
    registry_query::{filter, scope},
    Params, PostgresMaps,
};
use crate::map_store::{Facets, RegistryPage, RegistryRequest, RegistryRow};
use atlas_map::{MapColumn, MapFeatureType, MapRef};
use postgres::Row;
use std::{collections::BTreeMap, io};
/// A feature type's row: its map, revision, layer and identity.
type TypeKey = (uuid::Uuid, uuid::Uuid, i32, String);
impl PostgresMaps {
    pub fn registry(&self, r: &MapRef, request: &RegistryRequest) -> io::Result<RegistryPage> {
        if request.limit == 0
            || request.limit > 9_007_199_254_740_991
            || request.page > 9_007_199_254_740_991
        {
            return Err(io::Error::other("Choose a valid registry page"));
        }
        let map = self.open(r)?;
        let (scope, mut params) = scope(r, map.world_id, request)?;
        let columns = self.registry_columns(&scope, &params)?;
        let facets = self.registry_facets(&scope, &params)?;
        let predicate = filter(&request.query, &mut params)?;
        let counts = self.query(
            &format!("{scope} SELECT count(*) AS total,count(*) FILTER(WHERE {predicate}) AS matching FROM scoped"),
            &params.values(),
        )?;
        let count = counts
            .first()
            .ok_or_else(|| io::Error::other("Missing registry count"))?;
        let total = u64::try_from(get::<i64>(count, "total")?).map_err(io::Error::other)?;
        let matching = u64::try_from(get::<i64>(count, "matching")?).map_err(io::Error::other)?;
        let page = request
            .page
            .min(matching.div_ceil(request.limit).saturating_sub(1));
        let key = params.bind(request.sort.key.clone());
        let limit = params.bind(request.limit as i64);
        let offset = params.bind(i64::try_from(page * request.limit).map_err(io::Error::other)?);
        let direction = if request.sort.descending {
            "DESC"
        } else {
            "ASC"
        };
        let records = self.query(
            &format!(
                "{scope} SELECT {FEATURE_COLUMNS},f.type_layer FROM scoped f WHERE {predicate}
                 ORDER BY (v->>{key} IS NULL OR v->>{key}=''),CASE WHEN jsonb_typeof(v->{key})='number' THEN (v->>{key})::numeric END {direction},lower(v->>{key}) {direction},map_id,id
                 LIMIT {limit} OFFSET {offset}"
            ),
            &params.values(),
        )?;
        let features = self.features_from(&records)?;
        let keys = records
            .iter()
            .map(type_key)
            .collect::<io::Result<Vec<_>>>()?;
        let mut types = self.feature_types(&keys)?;
        let rows = records
            .iter()
            .zip(features)
            .zip(keys)
            .map(|((row, feature), key)| {
                let kind = types
                    .get(&key)
                    .cloned()
                    .ok_or_else(|| io::Error::other("A feature's type is not on its layer"))?;
                let values = feature.catalog.values.clone();
                Ok(RegistryRow {
                    reference: MapRef {
                        map_id: id(get(row, "map_id")?),
                        revision: id(get(row, "revision")?),
                    },
                    feature,
                    kind,
                    values,
                })
            })
            .collect::<io::Result<_>>()?;
        types.clear();
        Ok(RegistryPage {
            rows,
            total,
            matching,
            page,
            columns,
            facets,
        })
    }
    fn registry_columns(&self, scope: &str, params: &Params) -> io::Result<Vec<MapColumn>> {
        self.query(
            &format!("{scope} SELECT item->>'key' AS key,min(item->>'label') AS label,bool_or((item->>'numeric')::boolean) AS numeric FROM scoped,jsonb_array_elements(catalog->'columns') WITH ORDINALITY AS c(item,ordinal) GROUP BY item->>'key' ORDER BY min(ordinal),item->>'key'"),
            &params.values(),
        )?
        .iter()
        .map(|row| {
            Ok(MapColumn {
                key: get(row, "key")?,
                label: get(row, "label")?,
                numeric: get(row, "numeric")?,
            })
        })
        .collect()
    }
    fn registry_facets(&self, scope: &str, params: &Params) -> io::Result<Facets> {
        let mut categories = BTreeMap::new();
        for key in ["status", "state", "profile", "space"] {
            let mut values = params.values();
            values.push(&key);
            let placeholder = format!("${}", values.len());
            let rows = self.query(
                &format!("{scope} SELECT DISTINCT v->>{placeholder} AS value FROM scoped WHERE v->>{placeholder} IS NOT NULL AND v->>{placeholder}<>'' ORDER BY value"),
                &values,
            )?;
            categories.insert(
                key.into(),
                rows.iter()
                    .map(|row| get(row, "value"))
                    .collect::<io::Result<_>>()?,
            );
        }
        let keys = self
            .query(
                &format!("{scope} SELECT DISTINCT map_id,revision,type_layer,type_id FROM scoped"),
                &params.values(),
            )?
            .iter()
            .map(type_key)
            .collect::<io::Result<Vec<_>>>()?;
        let mut types: Vec<MapFeatureType> = self.feature_types(&keys)?.into_values().collect();
        types.sort_by(|a, b| a.id.cmp(&b.id).then(a.path.cmp(&b.path)));
        types.dedup();
        Ok(Facets { types, categories })
    }
    fn feature_types(&self, keys: &[TypeKey]) -> io::Result<BTreeMap<TypeKey, MapFeatureType>> {
        let mut found = BTreeMap::new();
        if keys.is_empty() {
            return Ok(found);
        }
        let maps: Vec<_> = keys.iter().map(|k| k.0).collect();
        let revisions: Vec<_> = keys.iter().map(|k| k.1).collect();
        let layers: Vec<_> = keys.iter().map(|k| k.2).collect();
        let ids: Vec<_> = keys.iter().map(|k| k.3.clone()).collect();
        for row in self.query(
            "SELECT t.* FROM map.feature_types t JOIN UNNEST($1::uuid[],$2::uuid[],$3::int[],$4::text[])
             AS k(map_id,revision,layer,id) USING(map_id,revision,layer,id)",
            &[&maps, &revisions, &layers, &ids],
        )? {
            let key = (get(&row, "map_id")?, get(&row, "revision")?, get(&row, "layer")?, get(&row, "id")?);
            found.insert(key, feature_type_row(&row)?.feature_type);
        }
        Ok(found)
    }
}
fn type_key(row: &Row) -> io::Result<TypeKey> {
    Ok((
        get(row, "map_id")?,
        get(row, "revision")?,
        get(row, "type_layer")?,
        get(row, "type_id")?,
    ))
}
