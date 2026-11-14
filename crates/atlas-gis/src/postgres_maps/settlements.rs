use super::{queries::feature, PostgresMaps};
use crate::map_store::Settlement;
use atlas_map::MapRef;
use serde_json::{json, Value};
use std::{collections::BTreeSet, io};
impl PostgresMaps {
    pub fn settlement(&self, r: &MapRef, id: &str) -> io::Result<Option<Settlement>> {
        self.open(r)?;
        let Some(row) = self
            .query(
                "SELECT data FROM map.features WHERE map_id=$1 AND revision=$2 AND id=$3",
                &[&r.map_id, &r.revision, &id],
            )?
            .into_iter()
            .next()
        else {
            return Ok(None);
        };
        let data: Value = row.try_get("data").map_err(io::Error::other)?;
        if data["kind"].as_str() != Some("settlement") {
            return Ok(None);
        }
        let beside=self.query("SELECT id,data FROM map.features WHERE map_id=$1 AND revision=$2 AND (data#>>'{attributes,fromPlace}'=$3 OR data#>>'{attributes,toPlace}'=$3 OR data#>>'{attributes,atPlace}'=$3)",&[&r.map_id,&r.revision,&id])?;
        let mut ids = BTreeSet::new();
        for row in beside {
            let way: Value = row.try_get("data").map_err(io::Error::other)?;
            let name: String = row.try_get("id").map_err(io::Error::other)?;
            for value in [
                Some(name.as_str()),
                way["attributes"]["fromPlace"].as_str(),
                way["attributes"]["toPlace"].as_str(),
            ]
            .into_iter()
            .flatten()
            {
                if value != id {
                    ids.insert(value.to_owned());
                }
            }
        }
        let relations = data["attributes"]["polityId"]
            .as_str()
            .map_or(Value::Null, |realm| json!([{"targetId":realm}]));
        let related=self.query("SELECT data,ST_AsGeoJSON(geometry,15,0)::json AS geometry FROM map.features WHERE map_id=$1 AND revision=$2 AND (id=ANY($3::text[]) OR (data->>'kind' IN ('sovereignty','control','claim') AND data->'relations' @> $4::jsonb)) ORDER BY id",&[&r.map_id,&r.revision,&ids.into_iter().collect::<Vec<_>>(),&relations])?.iter().map(feature).collect::<io::Result<_>>()?;
        Ok(Some(Settlement { related }))
    }
}
