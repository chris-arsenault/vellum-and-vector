use crate::{
    atlas::resolution::Profile,
    features::{
        chart::Chart,
        context::{Context, RealScaleMap},
    },
    scale::{LengthUnit, MapScale, RelativeMeasure},
    spatial::{SpatialKernel, SpatialResult},
};
use atlas_map::{
    CreatorLayer, MapDescriptor, MapFrame, MapRef, MapSpace, PublicationState, RealScale,
    RegionGeometry, RegionScale,
};
// hpc-exempt: coordinate-space identities in the map lineage, not cell membership.
use std::collections::BTreeSet;

pub struct Descriptor<'a> {
    pub context: &'a Context,
    pub chart: Chart<'a>,
    pub area: &'a str,
    pub reference: MapRef,
    pub parent: Option<MapRef>,
    pub precision: f64,
}
impl Descriptor<'_> {
    pub fn build(&self, spatial: &dyn SpatialKernel) -> SpatialResult<MapDescriptor> {
        let area = self.context.area(self.area)?;
        let footprint = match &area.footprint {
            atlas_map::Geometry::Polygon { coordinates } => {
                RegionGeometry::Polygon(coordinates.clone())
            }
            atlas_map::Geometry::MultiPolygon { coordinates } => {
                RegionGeometry::MultiPolygon(coordinates.clone())
            }
            _ => return Err("A map requires polygon geography".into()),
        };
        let space = self.context.space(self.area)?;
        let bounds = if space == self.context.id {
            self.chart.compact_bounds(&area.footprint, spatial)?
        } else {
            spatial.bounds(&area.footprint)?
        };
        let source = spatial.bounds(&area.footprint)?;
        let scale = MapScale::from_cells([source.0, source.1, source.2, source.3], 1.0)?;
        let minimum_width = scale
            .resolve(RelativeMeasure::new(0.000025, 1.0, 1.0, LengthUnit::Metre)?)?
            .value();
        let level = area.map.as_ref().map_or(0, |map| map.refinement_level);
        let next_level = level
            .checked_add(1)
            .ok_or("Regional level exceeds representation")?;
        Ok(MapDescriptor {
            reference: self.reference.clone(),
            world_id: self.context.id.clone(),
            name: area.name.clone(),
            primary_space_id: space.into(),
            profile: profile_name(area.profile).into(),
            region_scale: RegionScale {
                level,
                next_area: MapScale::REFERENCE_WIDTH * MapScale::REFERENCE_HEIGHT * 0.35
                    / 7.0_f64.powf(f64::from(next_level)),
                subdivision: 7.0,
                minimum_width,
                enabled: area.profile != Profile::Interior
                    && !area.profile.real_scale()
                    && area.context.as_deref() != Some("cave")
                    && area.frame.floor.is_none(),
            },
            footprint,
            bounds,
            spaces: self.spaces(spatial)?,
            parent: self.parent.clone(),
            state: PublicationState::Incomplete,
            layers: Vec::new(),
            real_scale: area
                .map
                .as_ref()
                .and_then(|map| map.real_scale)
                .map(|real| real_scale(&real, bounds)),
        })
    }
    fn spaces(&self, spatial: &dyn SpatialKernel) -> SpatialResult<Vec<MapSpace>> {
        // hpc-exempt: coordinate-space identities in the map lineage, not cell membership.
        let mut seen = BTreeSet::new();
        let mut spaces = Vec::new();
        for area in self.context.lineage(self.area)?.into_iter().rev() {
            let id = self.context.space(&area.id)?;
            if !seen.insert(id) {
                continue;
            }
            let global = id == self.context.id;
            let bounds = spatial.bounds(if global {
                self.chart.domain
            } else {
                &area.footprint
            })?;
            spaces.push(MapSpace {
                id: id.into(),
                bounds,
                parent_space_id: area
                    .parent_id
                    .as_deref()
                    .map(|parent| self.context.space(parent).map(String::from))
                    .transpose()?,
                metres_per_unit: area.frame.metres_per_unit,
                precision: self.precision,
                periodic_width: (global && self.chart.cylindrical).then_some(bounds.2 - bounds.0),
                frame: MapFrame {
                    origin: [
                        area.frame.origin.x,
                        area.frame.origin.y,
                        area.frame.origin.z,
                    ],
                    rotation: area.frame.rotation,
                    floor: area.frame.floor.clone(),
                },
            });
        }
        Ok(spaces)
    }
}
/// The located space beneath a ground map that holds its caves (ADR 0001): the surface's
/// planar frame, one floor down, so a cave and its entrances share coordinates.
pub fn underground_space(map: &MapDescriptor) -> Option<MapSpace> {
    let surface = map
        .spaces
        .iter()
        .find(|space| space.id == map.primary_space_id)?;
    Some(MapSpace {
        id: format!("{}:underground", surface.id),
        parent_space_id: Some(surface.id.clone()),
        bounds: map.bounds,
        metres_per_unit: surface.metres_per_unit,
        precision: surface.precision,
        periodic_width: None,
        frame: MapFrame {
            origin: surface.frame.origin,
            rotation: surface.frame.rotation,
            floor: Some(UNDERGROUND_FLOOR.into()),
        },
    })
}
/// The floor name of a ground map's underground space.
pub const UNDERGROUND_FLOOR: &str = "underground";
/// The published hex grid centres a hex on the map frame's centre, which is also the
/// shared lattice's origin, so the hexes group whole triangles (ADR 0016).
pub fn real_scale(real: &RealScaleMap, frame: atlas_map::Bounds) -> RealScale {
    RealScale {
        kind: real.kind,
        hex_size: real.hex_size.label().into(),
        across_flats: real.hex_size.across_flats(),
        feet: real.hex_size.feet(),
        origin: [(frame.0 + frame.2) / 2.0, (frame.1 + frame.3) / 2.0],
        triangles_per_edge: real.triangles_per_edge,
        creator_layers: vec![CreatorLayer {
            id: "base".into(),
            name: "Base layer".into(),
            locked: false,
        }],
        edits: 0,
    }
}
pub fn profile_name(profile: Profile) -> &'static str {
    match profile {
        Profile::World => "world",
        Profile::Region => "region",
        Profile::Local => "local",
        Profile::Site => "site",
        Profile::Interior => "interior",
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_ground_maps_caves_lie_one_floor_under_its_surface_frame() {
        let space = |id: &str, parent: Option<&str>| {
            serde_json::json!({"id":id, "parentSpaceId":parent, "bounds":[0.0, 0.0, 300.0, 200.0],
                "metresPerUnit":1.0, "precision":0.01, "periodicWidth":null,
                "frame":{"origin":[0.0, 0.0, 0.0], "rotation":0.0, "floor":null}})
        };
        let mut map: MapDescriptor = serde_json::from_value(serde_json::json!({
            "reference":{"mapId":"glen", "revision":"1"}, "worldId":"world", "name":"Glen",
            "primarySpaceId":"glen", "profile":"local",
            "regionScale":{"level":1, "nextArea":1.0, "subdivision":7.0, "minimumWidth":1.0, "enabled":false},
            "footprint":{"type":"Polygon", "coordinates":[[[0.0, 0.0], [300.0, 0.0], [300.0, 200.0], [0.0, 0.0]]]},
            "bounds":[0.0, 0.0, 300.0, 200.0], "spaces":[space("world", None), space("glen", Some("world"))],
            "parent":null, "state":"incomplete", "layers":[]
        }))
        .unwrap();
        let caves = underground_space(&map).unwrap();
        assert_eq!(caves.id, "glen:underground");
        assert_eq!(caves.parent_space_id.as_deref(), Some("glen"));
        assert_eq!(caves.frame.floor.as_deref(), Some(UNDERGROUND_FLOOR));
        assert_eq!(caves.bounds, map.bounds);
        map.spaces.push(caves);
        map.validate().unwrap();
    }
}
