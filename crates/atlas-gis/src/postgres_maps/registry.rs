use super::{
    from_json,
    queries::feature,
    registry_query::{filter, scope},
    Params, PostgresMaps,
};
use crate::map_store::{Facets, RegistryPage, RegistryRequest, RegistryRow};
use atlas_map::{MapColumn, MapRef};
use std::{collections::BTreeMap, io};
impl PostgresMaps {
    pub fn registry(&self, r: &MapRef, request: &RegistryRequest) -> io::Result<RegistryPage> {
        if request.limit == 0
            || request.limit > 9_007_199_254_740_991
            || request.page > 9_007_199_254_740_991
        {
            return Err(io::Error::other("Choose a valid registry page"));
        }
        let map = self.open(r)?;
        let (scope, mut params) = scope(r, &map.world_id, request)?;
        let columns = self.registry_columns(&scope, &params)?;
        let facets = self.registry_facets(&scope, &params)?;
        let predicate = filter(&request.query, &mut params)?;
        let counts=self.query(&format!("{scope} SELECT count(*) AS total,count(*) FILTER(WHERE {predicate}) AS matching FROM scoped"),&params.values())?;
        let count = counts
            .first()
            .ok_or_else(|| io::Error::other("Missing registry count"))?;
        let total = u64::try_from(count.try_get::<_, i64>("total").map_err(io::Error::other)?)
            .map_err(io::Error::other)?;
        let matching = u64::try_from(
            count
                .try_get::<_, i64>("matching")
                .map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?;
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
        let records=self.query(&format!("{scope} SELECT map_id,revision,data,type,ST_AsGeoJSON(geometry,15,0)::json AS geometry FROM scoped WHERE {predicate} ORDER BY (v->>{key} IS NULL OR v->>{key}=''),CASE WHEN jsonb_typeof(v->{key})='number' THEN (v->>{key})::numeric END {direction},lower(v->>{key}) {direction},map_id,id LIMIT {limit} OFFSET {offset}"),&params.values())?;
        let rows = records
            .iter()
            .map(|row| {
                let feature = feature(row)?;
                let values = feature.catalog.values.clone();
                Ok(RegistryRow {
                    reference: MapRef {
                        map_id: row.try_get("map_id").map_err(io::Error::other)?,
                        revision: row.try_get("revision").map_err(io::Error::other)?,
                    },
                    feature,
                    kind: from_json(row.try_get("type").map_err(io::Error::other)?)?,
                    values,
                })
            })
            .collect::<io::Result<_>>()?;
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
        self.query(&format!("{scope} SELECT item->>'key' AS key,min(item->>'label') AS label,bool_or((item->>'numeric')::boolean) AS numeric FROM scoped,jsonb_array_elements(data#>'{{catalog,columns}}') WITH ORDINALITY AS c(item,ordinal) GROUP BY item->>'key' ORDER BY min(ordinal),item->>'key'"),&params.values())?.iter().map(|row|Ok(MapColumn{key:row.try_get("key").map_err(io::Error::other)?,label:row.try_get("label").map_err(io::Error::other)?,numeric:row.try_get("numeric").map_err(io::Error::other)?})).collect()
    }
    fn registry_facets(&self, scope: &str, params: &Params) -> io::Result<Facets> {
        let mut categories = BTreeMap::new();
        for key in ["status", "state", "profile", "space"] {
            let mut values = params.values();
            values.push(&key);
            let placeholder = format!("${}", values.len());
            let rows=self.query(&format!("{scope} SELECT DISTINCT v->>{placeholder} AS value FROM scoped WHERE v->>{placeholder} IS NOT NULL AND v->>{placeholder}<>'' ORDER BY value"),&values)?;
            categories.insert(
                key.into(),
                rows.iter()
                    .map(|row| row.try_get("value").map_err(io::Error::other))
                    .collect::<io::Result<_>>()?,
            );
        }
        let types = self
            .query(
                &format!("{scope} SELECT DISTINCT type FROM scoped ORDER BY type"),
                &params.values(),
            )?
            .iter()
            .map(|row| from_json(row.try_get("type").map_err(io::Error::other)?))
            .collect::<io::Result<_>>()?;
        Ok(Facets { types, categories })
    }
}
