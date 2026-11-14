use super::Field;
use crate::{
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
};
use std::io;

pub struct Evidence {
    pub area: f64,
    pub span: f64,
    pub breadth: f64,
    pub coherence: f64,
    pub strength: f64,
    pub contrast: f64,
    pub relief: f64,
}
/// Area-weighted moments include each triangular cell's physical width and height.
pub fn region_evidence(
    field: &Field,
    members: &[usize],
    strength: impl Fn(usize) -> io::Result<f64>,
    same: impl Fn(usize) -> bool,
) -> io::Result<Evidence> {
    let mesh = &field.mesh;
    let origin = members
        .first()
        .map(|&cell| mesh.position(cell))
        .unwrap_or([0.0; 2]);
    let elevation = field.ground().view(GroundField::Elevation);
    let (mut area, mut x, mut y, mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    let (mut total_strength, mut contrast, mut margin) = (0.0, 0.0, 0.0);
    let (mut low, mut high) = (f64::INFINITY, f64::NEG_INFINITY);
    for &cell in members {
        let a = mesh.content_area(cell);
        let position = mesh.position(cell);
        let dx = mesh.delta_x(position[0] - origin[0]);
        let dy = position[1] - origin[1];
        let value = strength(cell)?;
        area += a;
        x += dx * a;
        y += dy * a;
        xx += (dx * dx + mesh.cell_width().powi(2) / 12.0) * a;
        xy += dx * dy * a;
        yy += (dy * dy + mesh.cell_height().powi(2) / 12.0) * a;
        total_strength += value * a;
        low = low.min(elevation.get(cell)?);
        high = high.max(elevation.get(cell)?);
        for edge in 0..3 {
            let Some(next) = mesh.neighbor(cell, edge) else {
                continue;
            };
            if same(next) {
                continue;
            }
            let length = mesh.face_length(cell, edge);
            contrast += (value - strength(next)?).max(0.0) * length;
            margin += length;
        }
    }
    let scale = area.max(1.0);
    let vx = (xx / scale - (x / scale).powi(2)).max(0.0);
    let vy = (yy / scale - (y / scale).powi(2)).max(0.0);
    let covariance = xy / scale - x * y / scale.powi(2);
    let difference = (vx - vy).hypot(2.0 * covariance);
    let span = (6.0 * (vx + vy + difference)).sqrt();
    let breadth = (6.0 * (vx + vy - difference)).max(0.0).sqrt();
    Ok(Evidence {
        area,
        span,
        breadth,
        coherence: (area / (span * breadth).max(1.0)).min(1.0),
        strength: total_strength / scale,
        contrast: if margin > 0.0 { contrast / margin } else { 0.0 },
        relief: MapScale::metres(high - low, LengthUnit::Native),
    })
}
