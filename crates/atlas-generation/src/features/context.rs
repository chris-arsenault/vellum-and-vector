//! Captured geographic ownership and coordinate frames used when publishing a map.
use crate::atlas::resolution::Profile;
use atlas_map::{Geometry, Id};
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub real_scale: Option<RealScaleMap>,
}
/// A real-scale map's captured choices: its kind, hex size and the detail it was laid at.
#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealScaleMap {
    pub kind: atlas_map::RealScaleKind,
    pub hex_size: crate::atlas::resolution::HexSize,
    pub hexes_across: u32,
    pub triangles_per_edge: u32,
}
impl RealScaleMap {
    /// The shared lattice's cell span for this map.
    pub fn cell_span(&self) -> f64 {
        crate::atlas::resolution::real_scale_span(self.hex_size, self.triangles_per_edge)
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Area {
    pub id: Id,
    pub name: String,
    pub parent_id: Option<Id>,
    pub space_id: Option<Id>,
    pub profile: Profile,
    pub context: Option<String>,
    pub region_id: Option<Id>,
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
    pub id: Id,
    // hpc-exempt: area ancestry by identity, not cell-indexed data.
    pub areas: BTreeMap<Id, Area>,
}
impl Context {
    pub fn area(&self, id: Id) -> Result<&Area, String> {
        self.areas
            .get(&id)
            .ok_or_else(|| format!("Missing area context: {id}"))
    }
    pub fn lineage(&self, id: Id) -> Result<Vec<&Area>, String> {
        let mut seen = BTreeSet::new();
        let mut result = Vec::new();
        let mut next = Some(id);
        while let Some(id) = next {
            if !seen.insert(id) {
                return Err("Geographic ancestry contains a cycle".into());
            }
            let area = self.area(id)?;
            result.push(area);
            next = area.parent_id;
        }
        Ok(result)
    }
    pub fn space(&self, id: Id) -> Result<Id, String> {
        for area in self.lineage(id)? {
            if let Some(id) = area.space_id {
                return Ok(id);
            }
            if area.profile == Profile::Interior
                || area.context.as_deref() == Some("cave")
                || area.frame.floor.is_some()
            {
                return Ok(area.id);
            }
        }
        Ok(self.id)
    }
    pub fn descendant(&self, child: Id, ancestor: Id) -> Result<bool, String> {
        Ok(self.lineage(child)?.iter().any(|area| area.id == ancestor))
    }
    pub fn geography_areas(&self, id: Id) -> Result<Vec<Id>, String> {
        let mut areas = Vec::new();
        for area in self.lineage(id)? {
            areas.push(area.id);
            if area.owns_geography() {
                break;
            }
        }
        Ok(areas)
    }
}
