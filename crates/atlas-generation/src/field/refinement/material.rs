use crate::rock::{catalogue, ground::query::GroundQuery};
pub fn cutting_resistance() -> GroundQuery<'static, Option<f64>> {
    let mut query = GroundQuery::new(None);
    query.loose = Some(Box::new(|_, layer, here| {
        Some(resistance(layer.strength, here.fracture, here.ward))
    }));
    query.rock = Some(Box::new(|cover, layer, here| {
        cover.or_else(|| Some(resistance(layer.strength, here.fracture, here.ward)))
    }));
    query.across_facets = Some(Box::new(|land, cut, share| {
        Some(land.unwrap_or(1.0) * (1.0 - share) + cut.unwrap_or(1.0) * share)
    }));
    query
}
fn resistance(strength: f64, fracture: f64, ward: f64) -> f64 {
    (strength / catalogue::kind_of_code(catalogue::STRATA).facts.resistance).powf(0.9)
        * (-0.5 * fracture).exp()
        * (1.0 + 0.5 * ward)
}
