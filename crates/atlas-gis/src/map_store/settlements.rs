use super::{description::key, queries::placeholders, MapStore};
use crate::sql::{column, Value};
use atlas_map::{Id, MapFeature, MapRef};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, io};
#[derive(Serialize, Deserialize)]
pub struct Settlement {
    pub related: Vec<MapFeature>,
}
impl MapStore {
    /// A settlement with the ways that reach it, the places those ways join it to and the
    /// realm areas it belongs to.
    pub fn settlement(&self, reference: &MapRef, id: Id) -> io::Result<Option<Settlement>> {
        let mut values = key(reference);
        values.push(id.into());
        let Some(row) = self
            .db
            .query(
                "SELECT kind,json_extract(attributes,'$.polityId') AS polity FROM map_features WHERE map_id=? AND revision=? AND id=?",
                &values,
            )?
            .into_iter()
            .next()
        else {
            return Ok(None);
        };
        if column(&row, "kind")?.text()? != "settlement" {
            return Ok(None);
        }
        // Ways name their ends in open attributes, as identity text.
        let mut values = key(reference);
        values.push(id.to_string().into());
        let beside = self.db.query(
            "SELECT id,json_extract(attributes,'$.fromPlace') AS from_place,json_extract(attributes,'$.toPlace') AS to_place FROM map_features
             WHERE map_id=?1 AND revision=?2 AND (json_extract(attributes,'$.fromPlace')=?3 OR json_extract(attributes,'$.toPlace')=?3 OR json_extract(attributes,'$.atPlace')=?3)",
            &values,
        )?;
        let mut ids = BTreeSet::new();
        for row in beside {
            ids.insert(column(&row, "id")?.id()?);
            for end in ["from_place", "to_place"] {
                if let Some(place) = column(&row, end)?
                    .optional_text()?
                    .and_then(|text| text.parse::<Id>().ok())
                {
                    ids.insert(place);
                }
            }
        }
        if let Some(realm) = column(&row, "polity")?
            .optional_text()?
            .and_then(|text| text.parse::<Id>().ok())
        {
            let mut values = key(reference);
            values.push(realm.into());
            for row in self.db.query(
                "SELECT f.id FROM map_features f WHERE f.map_id=?1 AND f.revision=?2 AND f.kind IN ('sovereignty','control','claim')
                 AND EXISTS(SELECT 1 FROM map_relations r WHERE r.map_id=f.map_id AND r.revision=f.revision AND r.feature_id=f.id AND r.target_id=?3)",
                &values,
            )? {
                ids.insert(column(&row, "id")?.id()?);
            }
        }
        ids.remove(&id);
        if ids.is_empty() {
            return Ok(Some(Settlement {
                related: Vec::new(),
            }));
        }
        let mut values = key(reference);
        values.extend(ids.iter().copied().map(Value::from));
        let rows = self.db.query(
            &format!(
                "SELECT * FROM map_features WHERE map_id=? AND revision=? AND id IN ({}) ORDER BY id",
                placeholders(ids.len())
            ),
            &values,
        )?;
        Ok(Some(Settlement {
            related: self.features_from(&rows)?,
        }))
    }
}
