//! Real-scale ground detail (ADR 0016): what a map whose hexes are a few metres to a few hundred
//! metres across shows at its real size once its land is developed. Channels take their width
//! and depth from their own discharge and bed; pools form where the flow slackens, meets or
//! scours a bend; rock shows where cover is thin or too steep to stay; trails run from the places
//! people visit to the ways they already use; fords and bridges stand where ways meet water; and
//! single plants and stones stand on maps fine enough to show them. Each module is a pure
//! process on explicit inputs in the map's metres; the state adapters read and publish.
pub mod channels;
pub mod cover;
pub mod crossings;
pub mod exposure;
pub mod pools;
pub mod settings;
pub mod trails;

/// Distance between two points in the map's metres.
pub fn distance(a: [f64; 2], b: [f64; 2]) -> f64 {
    (b[0] - a[0]).hypot(b[1] - a[1])
}
/// Running distance along a line at each vertex.
pub fn stations(points: &[[f64; 2]]) -> Vec<f64> {
    let mut along = Vec::with_capacity(points.len());
    let mut total = 0.0;
    for (at, point) in points.iter().enumerate() {
        if at > 0 {
            total += distance(points[at - 1], *point);
        }
        along.push(total);
    }
    along
}
