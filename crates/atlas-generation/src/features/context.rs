//! Captured geographic ownership and coordinate frames used when publishing a map.
use crate::atlas::resolution::Profile;
use atlas_map::Geometry;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Origin {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub origin: Origin,
    pub rotation: f64,
    pub floor: Option<String>,
    pub metres_per_unit: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapOwnership {
    pub refinement_level: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extent: Option<Geometry>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Area {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub space_id: Option<String>,
    pub profile: Profile,
    pub context: Option<String>,
    pub region_id: Option<String>,
    pub footprint: Geometry,
    pub frame: Frame,
    pub map: Option<MapOwnership>,
}
impl Area {
    pub fn owns_geography(&self) -> bool {
        self.parent_id.is_none() || self.map.is_some()
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Context {
    pub id: String,
    // hpc-exempt: named area ancestry, not cell-indexed data.
    pub areas: BTreeMap<String, Area>,
}
impl Context {
    pub fn area(&self, id: &str) -> Result<&Area, String> {
        self.areas
            .get(id)
            .ok_or_else(|| format!("Missing area context: {id}"))
    }
    pub fn lineage<'a>(&'a self, id: &str) -> Result<Vec<&'a Area>, String> {
        let mut seen = BTreeSet::new();
        let mut result = Vec::new();
        let mut next = Some(id);
        while let Some(id) = next {
            if !seen.insert(id.to_owned()) {
                return Err("Geographic ancestry contains a cycle".into());
            }
            let area = self.area(id)?;
            result.push(area);
            next = area.parent_id.as_deref();
        }
        Ok(result)
    }
    pub fn space(&self, id: &str) -> Result<&str, String> {
        for area in self.lineage(id)? {
            if let Some(id) = &area.space_id {
                return Ok(id);
            }
            if area.profile == Profile::Interior
                || area.context.as_deref() == Some("cave")
                || area.frame.floor.is_some()
            {
                return Ok(&area.id);
            }
        }
        Ok(&self.id)
    }
    pub fn descendant(&self, child: &str, ancestor: &str) -> Result<bool, String> {
        Ok(self.lineage(child)?.iter().any(|area| area.id == ancestor))
    }
    pub fn geography_areas(&self, id: &str) -> Result<Vec<&str>, String> {
        let mut areas = Vec::new();
        for area in self.lineage(id)? {
            areas.push(area.id.as_str());
            if area.owns_geography() {
                break;
            }
        }
        Ok(areas)
    }
}
