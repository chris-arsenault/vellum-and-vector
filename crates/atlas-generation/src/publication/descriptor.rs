use crate::{
    atlas::resolution::Profile,
    features::{chart::Chart, context::Context},
    scale::{LengthUnit, MapScale, RelativeMeasure},
    spatial::{SpatialKernel, SpatialResult},
};
use atlas_map::{
    MapDescriptor, MapFrame, MapRef, MapSpace, PublicationState, RegionGeometry, RegionScale,
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
                    && area.context.as_deref() != Some("cave")
                    && area.frame.floor.is_none(),
            },
            footprint,
            bounds,
            spaces: self.spaces(spatial)?,
            parent: self.parent.clone(),
            state: PublicationState::Incomplete,
            layers: Vec::new(),
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
pub fn profile_name(profile: Profile) -> &'static str {
    match profile {
        Profile::World => "world",
        Profile::Region => "region",
        Profile::Local => "local",
        Profile::Site => "site",
        Profile::Interior => "interior",
    }
}
