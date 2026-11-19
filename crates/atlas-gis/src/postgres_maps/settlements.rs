use super::{features::FEATURE_COLUMNS, uuid, uuids, PostgresMaps};
use crate::map_store::Settlement;
use atlas_map::{Id, MapRef};
use std::{collections::BTreeSet, io};
impl PostgresMaps {
    /// A settlement with the ways that reach it, the places those ways join it to and the
    /// realm areas it belongs to.
    pub fn settlement(&self, r: &MapRef, settlement: Id) -> io::Result<Option<Settlement>> {
        let (map_id, revision) = (uuid(r.map_id), uuid(r.revision));
        let Some(row) = self
            .query(
                "SELECT kind,attributes->>'polityId' AS polity FROM map.features WHERE map_id=$1 AND revision=$2 AND id=$3",
                &[&map_id, &revision, &uuid(settlement)],
            )?
            .into_iter()
            .next()
        else {
            return Ok(None);
        };
        if row.try_get::<_, String>("kind").map_err(io::Error::other)? != "settlement" {
            return Ok(None);
        }
        let polity = row
            .try_get::<_, Option<String>>("polity")
            .map_err(io::Error::other)?
            .and_then(|text| text.parse::<Id>().ok());
        // Ways name their ends in open attributes, as identity text.
        let text = settlement.to_string();
        let beside = self.query(
            "SELECT id,attributes->>'fromPlace' AS from_place,attributes->>'toPlace' AS to_place FROM map.features
             WHERE map_id=$1 AND revision=$2 AND (attributes->>'fromPlace'=$3 OR attributes->>'toPlace'=$3 OR attributes->>'atPlace'=$3)",
            &[&map_id, &revision, &text],
        )?;
        let mut ids = BTreeSet::new();
        for row in beside {
            ids.insert(super::id(row.try_get("id").map_err(io::Error::other)?));
            for end in ["from_place", "to_place"] {
                let place: Option<String> = row.try_get(end).map_err(io::Error::other)?;
                if let Some(place) = place.and_then(|p| p.parse::<Id>().ok()) {
                    ids.insert(place);
                }
            }
        }
        ids.remove(&settlement);
        let ids = uuids(&ids.into_iter().collect::<Vec<_>>());
        let rows = self.query(
            &format!(
                "SELECT {FEATURE_COLUMNS} FROM map.features f WHERE f.map_id=$1 AND f.revision=$2 AND (f.id=ANY($3)
                 OR (f.kind IN ('sovereignty','control','claim') AND EXISTS(SELECT 1 FROM map.relations l
                 WHERE l.map_id=f.map_id AND l.revision=f.revision AND l.feature_id=f.id AND l.target_id=$4))) ORDER BY f.id"
            ),
            &[&map_id, &revision, &ids, &polity.map(uuid)],
        )?;
        Ok(Some(Settlement {
            related: self.features_from(&rows)?,
        }))
    }
}
