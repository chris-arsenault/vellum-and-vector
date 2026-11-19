//! What a town's buildings and streets may stand on. A building keeps off water, ways, other
//! buildings and every plot but its own; a street keeps off buildings and crosses only water
//! narrow enough for the place to bridge.
use super::{family, frontage::is_building, plan::title};
use crate::{
    hexes::widened_footprint,
    regions::point,
    spatial::{Overlay, Predicate, SpatialKernel, SpatialResult},
    Geometry, MapFeature,
};

/// Overlap in square metres at which two shapes stand on each other rather than touch.
pub const OVERLAP: f64 = 0.5;

/// The ground a feature covers: an outline as drawn, a line widened to its widths, or the bare
/// line when it states none.
pub fn covered(feature: &MapFeature, spatial: &dyn SpatialKernel) -> SpatialResult<Geometry> {
    if matches!(feature.geometry, Geometry::LineString { .. }) {
        if let Some(area) =
            widened_footprint(&feature.geometry, feature.attributes.get("widths"), spatial)?
        {
            return Ok(area);
        }
    }
    Ok(feature.geometry.clone())
}
fn is_area(geometry: &Geometry) -> bool {
    matches!(
        geometry,
        Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }
    )
}
/// Whether two covered grounds overlap by more than a touch.
pub fn overlaps(a: &Geometry, b: &Geometry, spatial: &dyn SpatialKernel) -> SpatialResult<bool> {
    if !(is_area(a) && is_area(b)) {
        return spatial.relation(a, b, Predicate::Intersects);
    }
    match spatial.overlay(a, b, Overlay::Intersection)? {
        Some(shared) => Ok(spatial.area(&shared)? > OVERLAP),
        None => Ok(false),
    }
}
/// Map water a town keeps off: channels, lakes, pools and the sea.
pub fn is_water(feature: &MapFeature) -> bool {
    matches!(family(&feature.layer_id), "rivers" | "lakes" | "oceans")
}
fn is_way(feature: &MapFeature) -> bool {
    family(&feature.layer_id) == "roads"
}
fn is_plot(feature: &MapFeature) -> bool {
    family(&feature.layer_id) == "plots"
}
/// Refuses a building standing on water, a way, another building or a plot other than
/// `own_plot`.
pub fn building_clear(
    building: &MapFeature,
    around: &[MapFeature],
    own_plot: Option<crate::Id>,
    spatial: &dyn SpatialKernel,
) -> Result<(), String> {
    for other in around.iter().filter(|other| other.id != building.id) {
        let what = if is_water(other) {
            "water"
        } else if is_way(other) {
            "the way"
        } else if is_building(other) || (is_plot(other) && Some(other.id) != own_plot) {
            "the ground"
        } else {
            continue;
        };
        if overlaps(&building.geometry, &covered(other, spatial)?, spatial)? {
            return Err(format!(
                "{} would stand on {what} of {}",
                title(building),
                title(other)
            ));
        }
    }
    Ok(())
}
/// Refuses a street through a building or across water wider than `span` metres.
pub fn street_clear(
    street: &MapFeature,
    around: &[MapFeature],
    span: f64,
    spatial: &dyn SpatialKernel,
) -> Result<(), String> {
    let ground = covered(street, spatial)?;
    for building in around.iter().filter(|f| is_building(f)) {
        if overlaps(&ground, &building.geometry, spatial)? {
            return Err(format!(
                "{} would run through {}",
                title(street),
                title(building)
            ));
        }
    }
    for (water, crossing) in water_crossings(&street.geometry, around, spatial)? {
        let length = spatial.length(&crossing)?;
        if length > span {
            return Err(format!(
                "{} is about {:.0} m wide here, too wide for this place to bridge",
                title(water),
                length
            ));
        }
    }
    Ok(())
}
/// Each stretch of a street's line over water, with the water it crosses.
pub fn water_crossings<'a>(
    line: &Geometry,
    around: &'a [MapFeature],
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Vec<(&'a MapFeature, Geometry)>> {
    let mut found = Vec::new();
    for water in around.iter().filter(|f| is_water(f)) {
        let area = covered(water, spatial)?;
        if !is_area(&area) {
            continue;
        }
        let Some(over) = spatial.overlay(line, &area, Overlay::Intersection)? else {
            continue;
        };
        for piece in lines(over) {
            found.push((water, piece));
        }
    }
    Ok(found)
}
fn lines(geometry: Geometry) -> Vec<Geometry> {
    match geometry {
        Geometry::LineString { .. } => vec![geometry],
        Geometry::MultiLineString { coordinates } => coordinates
            .into_iter()
            .map(|coordinates| Geometry::LineString { coordinates })
            .collect(),
        Geometry::GeometryCollection { geometries } => {
            geometries.into_iter().flat_map(lines).collect()
        }
        _ => Vec::new(),
    }
}
/// The plot a building stands in: the first plot whose ground holds the building's centre.
pub fn plot_under<'a>(
    building: &MapFeature,
    plots: impl IntoIterator<Item = &'a MapFeature>,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Option<&'a MapFeature>> {
    let centre = point(spatial.interior_position(&building.geometry)?);
    for plot in plots {
        if super::frontage::is_yard(plot)
            && spatial.relation(&plot.geometry, &centre, Predicate::Intersects)?
        {
            return Ok(Some(plot));
        }
    }
    Ok(None)
}
