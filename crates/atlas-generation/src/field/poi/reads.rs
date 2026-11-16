use super::state::State;
use crate::{
    features::{Feature, FeatureSelection},
    field::{shared::Scalar, Field},
    magic::{channels::Channel, state::MagicField},
    rock::ground::{
        queries::{surface_kind, surface_response, SurfaceResponse},
        GroundField,
    },
    scale::{LengthUnit, MapScale},
};
use atlas_map::{Geometry, Position};
use std::{io, rc::Rc};
pub fn height(field: &Field, cell: usize) -> io::Result<f64> {
    Ok(MapScale::metres(
        field.ground().view(GroundField::Elevation).get(cell)? - field.water().effective_sea_level,
        LengthUnit::Native,
    ))
}
pub fn celsius(field: &Field, cell: usize) -> io::Result<f64> {
    Ok(field.shared.scalar(Scalar::Temperature).get(cell)? * 0.1 - 30.0)
}
pub fn rock(field: &Field, cell: usize, response: SurfaceResponse) -> io::Result<f64> {
    field.ground().fold(cell, &surface_response(response), None)
}
pub fn rock_kind(field: &Field, cell: usize) -> io::Result<usize> {
    field.ground().fold(cell, &surface_kind(), None)
}
pub fn discharge(field: &Field, cell: usize) -> io::Result<f64> {
    let water = field.water.borrow();
    Ok(water
        .river_reader()
        .water_at(cell, false, water.read_only().flow.mean.get(cell)?))
}
/// The river's channel width at a cell in metres, zero where no reach is resolved.
pub fn river_width(field: &Field, cell: usize) -> io::Result<f64> {
    let water = field.water.borrow();
    Ok(water
        .river_reader()
        .sample(cell, crate::water::network::RiverSample::Width, 0.0)
        .max(0.0))
}
pub fn has_channel(field: &Field, cell: usize) -> io::Result<bool> {
    let water = field.water.borrow();
    Ok(water
        .river_reader()
        .order_at(cell, water.read_only().column.kind.get(cell)?)
        > 0)
}
pub fn first_coordinate(geometry: &Geometry) -> Option<Position> {
    match geometry {
        Geometry::Point { coordinates } => Some(*coordinates),
        Geometry::LineString { coordinates } | Geometry::MultiPoint { coordinates } => {
            coordinates.first().copied()
        }
        Geometry::Polygon { coordinates } | Geometry::MultiLineString { coordinates } => {
            coordinates.first()?.first().copied()
        }
        Geometry::MultiPolygon { coordinates } => coordinates.first()?.first()?.first().copied(),
        Geometry::GeometryCollection { geometries } => first_coordinate(geometries.first()?),
    }
}
pub fn feature_cell(field: &Field, feature: &Feature) -> Option<usize> {
    let [x, y, _] = first_coordinate(&feature.geometry)?.coordinates();
    let origin = field.mesh.origin();
    field.mesh.cell_at(x - origin[0], y - origin[1])
}
pub fn inhabited(feature: &Feature) -> bool {
    !feature
        .attributes
        .get("status")
        .and_then(|v| v.as_str())
        .is_some_and(|s| ["abandoned", "ruined"].contains(&s))
}
pub fn settlements(state: &impl State) -> io::Result<Rc<Vec<Feature>>> {
    state.held().get("settlementRecords", || {
        state
            .features()
            .values(FeatureSelection {
                kind: Some("settlement"),
                layer_id: Some("settlements"),
                ..Default::default()
            })?
            .filter_map(|f| match f {
                Ok(f) if inhabited(&f) => Some(Ok(f)),
                Err(e) => Some(Err(e)),
                _ => None,
            })
            .collect()
    })
}
pub fn magic_field<'a>(
    state: &'a impl State,
    system: &str,
) -> Option<std::cell::Ref<'a, MagicField>> {
    std::cell::Ref::filter_map(state.magic()?, |fields| {
        fields.iter().find(|f| f.definition().id == system)
    })
    .ok()
}
pub fn magic_rule(state: &impl State, system: &str, rule: &str, cell: usize) -> io::Result<bool> {
    let Some(field) = magic_field(state, system) else {
        return Ok(false);
    };
    let Some(index) = field
        .definition()
        .features
        .iter()
        .position(|f| f.id == rule)
    else {
        return Ok(false);
    };
    Ok(field.feature(index).0.get(cell)? > 0.0)
}
pub fn magic_value(
    state: &impl State,
    system: &str,
    channel: Channel,
    cell: usize,
) -> io::Result<f64> {
    magic_field(state, system)
        .map(|f| f.channel(channel).get(cell))
        .unwrap_or(Ok(0.0))
}
