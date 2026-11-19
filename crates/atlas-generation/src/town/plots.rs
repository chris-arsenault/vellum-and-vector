//! Plots fronting the streets and the building on each.
use super::{
    geometry::{add, at, left, rectangle, scale, Point},
    network::Street,
};
pub use atlas_map::town::Side;
use atlas_map::town::VERGE;

/// A physical site with an entrance and a local frame for laying out buildings.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Slot {
    pub habitat: super::templates::Habitat,
    pub tenure: super::templates::Tenure,
    pub participant: Option<super::fabric::HoldingId>,
    // owner-direction(2026-11-18): individual buildings can grow on land without a street
    pub street: Option<usize>,
    pub side: Side,
    pub along: f64,
    pub corners: Vec<Point>,
    /// Entrance on the front edge, direction along that edge and direction into the site.
    pub front: Point,
    pub direction: Point,
    pub inward: Point,
    pub frontage: f64,
    pub depth: f64,
}
use super::settings::{DEPTH_VARIATION, FRONTAGE_VARIATION, PITCH_FILL};
impl Slot {
    /// The rectangle bounds a berth or chamber. Its built hull occupies a
    /// tapered deck; a submerged chamber closes around a rounded pressure wall.
    pub fn occupied_shape(&self) -> atlas_map::Geometry {
        use super::templates::Habitat;
        let outline = match self.habitat {
            Habitat::Floating => vec![
                [-0.28, 0.],
                [0.28, 0.],
                [0.5, 0.18],
                [0.46, 0.78],
                [0., 1.],
                [-0.46, 0.78],
                [-0.5, 0.18],
                [-0.28, 0.],
            ],
            Habitat::Submerged => (0..=16)
                .map(|i| {
                    let angle = i as f64 * std::f64::consts::TAU / 16.;
                    [0.5 * angle.sin(), 0.5 - 0.5 * angle.cos()]
                })
                .collect(),
            _ => return super::fabric::polygon(&self.corners),
        };
        let mut corners: Vec<_> = outline
            .iter()
            .map(|&[x, y]| {
                add(
                    self.front,
                    add(
                        scale(self.direction, x * self.frontage),
                        scale(self.inward, y * self.depth),
                    ),
                )
            })
            .collect();
        let first = corners[0];
        *corners.last_mut().unwrap() = first;
        super::fabric::polygon(&corners)
    }
}
/// Every plot place along both sides of a street, from its start.
pub fn slots(index: usize, street: &Street, frontage: f64, depth: f64) -> Vec<Slot> {
    let length = street.length();
    let mut result = Vec::new();
    for side in [Side::Left, Side::Right] {
        let sign = if side == Side::Left { 1.0 } else { -1.0 };
        let mut cursor = (street.width_at(0.) - frontage).max(0.0) / 2.0;
        let mut ordinal = 0;
        while cursor < length {
            let sample = |salt| {
                crate::noise::hash_unit(
                    index as i32 ^ salt,
                    street.points[0][0] + ordinal as f64,
                    street.points[0][1] + sign,
                )
            };
            let pitch = frontage * (1.0 + FRONTAGE_VARIATION * (2.0 * sample(0x5711) - 1.0));
            let parcel_depth = depth * (1.0 + DEPTH_VARIATION * (2.0 * sample(0x2d31) - 1.0));
            if cursor + pitch > length {
                break;
            }
            let along = cursor + pitch / 2.0;
            if let Some((p, d)) = at(&street.points, along) {
                let inward = scale(left(d), sign);
                let front = add(p, scale(inward, street.width_at(along) / 2.0 + VERGE));
                result.push(Slot {
                    habitat: super::templates::Habitat::Ground,
                    tenure: super::templates::Tenure::Household,
                    participant: None,
                    street: Some(index),
                    side,
                    along,
                    corners: rectangle(front, d, inward, pitch * PITCH_FILL, parcel_depth),
                    front,
                    direction: d,
                    inward,
                    frontage: pitch,
                    depth: parcel_depth,
                });
            }
            cursor += pitch;
            ordinal += 1;
        }
    }
    result
}

/// Uses offering frontage around their boundary can admit project partners there.
pub fn participant_slots(holding: &super::fabric::Holding) -> Vec<Slot> {
    use super::catalogue::PlaceRules;
    if holding
        .kind
        .definition()
        .roles
        .frontage_activities
        .is_empty()
    {
        return vec![];
    }
    match &holding.outline {
        atlas_map::Geometry::Polygon { coordinates } => coordinates
            .first()
            .into_iter()
            .flat_map(|ring| edge_slots(&holding.slot, holding.id, ring))
            .collect(),
        atlas_map::Geometry::MultiPolygon { coordinates } => coordinates
            .iter()
            .filter_map(|polygon| polygon.first())
            .flat_map(|ring| edge_slots(&holding.slot, holding.id, ring))
            .collect(),
        _ => vec![],
    }
}

fn edge_slots(
    slot: &Slot,
    participant: super::fabric::HoldingId,
    ring: &[atlas_map::Position],
) -> Vec<Slot> {
    use super::geometry::{distance, sub, unit};
    let points: Vec<_> = ring
        .iter()
        .map(|p| {
            let [x, y, _] = p.coordinates();
            [x, y]
        })
        .collect();
    let area: f64 = points
        .windows(2)
        .map(|e| {
            let a = sub(e[0], slot.front);
            let b = sub(e[1], slot.front);
            a[0] * b[1] - a[1] * b[0]
        })
        .sum();
    let mut slots = Vec::new();
    for edge in points.windows(2) {
        let length = distance(edge[0], edge[1]);
        let count = (length / 7.).floor() as usize;
        if count == 0 {
            continue;
        }
        let direction = unit(sub(edge[1], edge[0]));
        let inward = scale(left(direction), -area.signum());
        let frontage = length / count as f64;
        for index in 0..count {
            let front = add(edge[0], scale(direction, frontage * (index as f64 + 0.5)));
            slots.push(Slot {
                participant: Some(participant),
                front,
                direction,
                inward,
                frontage,
                depth: 20.,
                corners: rectangle(front, direction, inward, frontage, 20.),
                ..slot.clone()
            });
        }
    }
    slots
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::atlas::town::{geometry::resample, network::Class, story::Size};
    fn street() -> Street {
        Street::new(
            resample(&[[0.0, 0.0], [100.0, 0.0]], 10.0),
            Class::Main,
            Size::Town,
        )
    }
    #[test]
    fn candidate_frontages_vary_on_both_sides_of_a_street() {
        let street = street();
        let all = slots(0, &street, 8.0, 24.0);
        let left = all.iter().filter(|s| s.side == Side::Left).count();
        assert!(left > 0 && left < all.len());
        assert!(all.windows(2).any(|s| s[0].frontage != s[1].frontage));
        assert!(all.windows(2).any(|s| s[0].depth != s[1].depth));
        assert!(all
            .iter()
            .all(|s| (s.front[1].abs() - (4.0 + VERGE)).abs() < 1e-9));
    }
}
