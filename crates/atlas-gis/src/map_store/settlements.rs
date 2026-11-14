use super::{json, reference_values, MapStore};
use crate::sql::column;
use atlas_map::{MapFeature, MapRef};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, io};
#[derive(Serialize, Deserialize)]
pub struct Settlement {
    pub related: Vec<MapFeature>,
}
impl MapStore {
    pub fn settlement(&self, reference: &MapRef, id: &str) -> io::Result<Option<Settlement>> {
        self.open(reference)?;
        let mut values = reference_values(reference);
        values.push(id.into());
        let Some(row) = self
            .db
            .query(
                "SELECT * FROM map_features WHERE map_id=? AND revision=? AND id=?",
                &values,
            )?
            .into_iter()
            .next()
        else {
            return Ok(None);
        };
        let feature = self.feature(&row)?;
        if feature.kind != "settlement" {
            return Ok(None);
        }
        let beside = self.db.query("SELECT f.* FROM map_features f JOIN map_feature_catalog c USING(row_id) WHERE f.map_id=?1 AND f.revision=?2 AND (json_extract(c.attributes_json,'$.fromPlace')=?3 OR json_extract(c.attributes_json,'$.toPlace')=?3 OR json_extract(c.attributes_json,'$.atPlace')=?3)",&values)?;
        let mut ids = BTreeSet::new();
        for row in beside {
            let way = self.feature(&row)?;
            for value in [
                Some(way.id.as_str()),
                way.attributes
                    .get("fromPlace")
                    .and_then(serde_json::Value::as_str),
                way.attributes
                    .get("toPlace")
                    .and_then(serde_json::Value::as_str),
            ]
            .into_iter()
            .flatten()
            {
                if value != id {
                    ids.insert(value.to_owned());
                }
            }
        }
        if let Some(realm) = feature
            .attributes
            .get("polityId")
            .and_then(serde_json::Value::as_str)
        {
            let mut values = reference_values(reference);
            values.push(realm.into());
            for row in self.db.query("SELECT f.id FROM map_features f JOIN map_feature_catalog c USING(row_id) WHERE f.map_id=? AND f.revision=? AND json_extract(c.type,'$.kind') IN ('sovereignty','control','claim') AND EXISTS(SELECT 1 FROM json_each(c.relations_json) r WHERE json_extract(r.value,'$.targetId')=?)",&values)? {ids.insert(column(&row,"id")?.text()?.into());}
        }
        let mut values = reference_values(reference);
        values.push(json(&ids)?);
        let related = self.db.query("SELECT * FROM map_features WHERE map_id=? AND revision=? AND id IN (SELECT value FROM json_each(?)) ORDER BY id",&values)?.iter().map(|row| self.feature(row)).collect::<io::Result<_>>()?;
        Ok(Some(Settlement { related }))
    }
}
