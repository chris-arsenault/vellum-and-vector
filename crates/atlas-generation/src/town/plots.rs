//! Plots fronting the streets and the building on each.
use super::{
    geometry::{add, at, left, rectangle, scale, Point},
    network::Street,
    scale::{Measure, TownScale},
};
pub use atlas_map::town::Side;
use atlas_map::town::VERGE;
/// The pitch and depth of the plots a holding offers its partners round its boundary. Street
/// metres, resolved by `Measure::Plot`.
const PARTNER_PITCH: f64 = 7.;
const PARTNER_DEPTH: f64 = 20.;

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

/// Occupied intervals on either side of each street, in metres along its centreline.
pub(crate) struct OccupiedFronts(Vec<[Vec<(f64, f64)>; 2]>);
impl OccupiedFronts {
    pub fn new(town: &super::fabric::Town) -> Self {
        let mut rows = vec![[Vec::new(), Vec::new()]; town.streets().len()];
        for h in town
            .holdings()
            .iter()
            .filter(|h| h.occupation > 0. && !h.buildings.is_empty())
        {
            if let Some(i) = h.slot.street {
                rows[i][usize::from(h.slot.side == Side::Right)]
                    .push((h.slot.along, h.slot.frontage));
            }
        }
        for row in rows.iter_mut().flatten() {
            // hpc-exempt: physical intervals in street address order.
            row.sort_by(|a, b| a.0.total_cmp(&b.0));
        }
        Self(rows)
    }
    /// A premise can share access and neighbours on either flank. Independent
    /// sites still compete at their ordinary value.
    pub fn infill(&self, slot: &Slot) -> f64 {
        let Some(i) = slot.street else { return 1. };
        let row = &self.0[i][usize::from(slot.side == Side::Right)];
        1. + Self::neighbours(row, slot.along)
            .map(|&(along, width)| {
                let gap = ((along - slot.along).abs() - (width + slot.frontage) * 0.5).max(0.);
                (1. - gap / slot.depth).max(0.)
            })
            .sum::<f64>()
    }
    /// The occupied frontage on either side nearest a proposed public junction.
    pub(crate) fn served_front(&self, street: usize, station: f64, reach: f64) -> f64 {
        self.0[street]
            .iter()
            .flat_map(|row| Self::neighbours(row, station))
            .map(|&(along, width)| {
                let gap = ((station - along).abs() - width * 0.5).max(0.);
                width * (1. - gap / reach).max(0.)
            })
            .sum()
    }
    /// A gap in an occupied bank can give the plots behind it access. Houses
    /// across the road provide no reason to cut a side lane into an empty bank.
    pub(crate) fn flanks_opening(&self, slot: &Slot) -> bool {
        let Some(street) = slot.street else {
            return false;
        };
        let row = &self.0[street][usize::from(slot.side == Side::Right)];
        let mut adjacent = Self::neighbours(row, slot.along).filter(|&&(along, width)| {
            (along - slot.along).abs() - (width + slot.frontage) / 2. <= slot.depth
        });
        adjacent.next().zip(adjacent.next()).is_some()
    }
    fn neighbours(row: &[(f64, f64)], station: f64) -> impl Iterator<Item = &(f64, f64)> {
        let split = row.partition_point(|(along, _)| *along < station);
        split
            .checked_sub(1)
            .and_then(|i| row.get(i))
            .into_iter()
            .chain(row.get(split))
    }
}
/// Every plot place along both sides of a street, from its start, of about this frontage and
/// depth, each its verge back from the street at `scale`.
pub fn slots(
    index: usize,
    street: &Street,
    frontage: f64,
    depth: f64,
    town_scale: TownScale,
) -> Vec<Slot> {
    let verge = town_scale.length(VERGE, Measure::Plot);
    let length = street.length();
    let mut result = Vec::new();
    for side in [Side::Left, Side::Right] {
        let sign = if side == Side::Left { 1.0 } else { -1.0 };
        let mut cursor = (street.width_at(0.) - frontage).max(0.0) / 2.0;
        let mut ordinal = 0;
        while cursor < length {
            let sample = |salt| {
                crate::chance::Chance::of(index as i32, salt).unit([
                    street.points[0][0] + ordinal as f64,
                    street.points[0][1] + sign,
                ])
            };
            let pitch = frontage * (1.0 + FRONTAGE_VARIATION * (2.0 * sample(0x5711) - 1.0));
            let parcel_depth = depth * (1.0 + DEPTH_VARIATION * (2.0 * sample(0x2d31) - 1.0));
            if cursor + pitch > length {
                break;
            }
            let along = cursor + pitch / 2.0;
            if let Some((p, d)) = at(&street.points, along) {
                let inward = scale(left(d), sign);
                let front = add(p, scale(inward, street.width_at(along) / 2.0 + verge));
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

/// Uses offering frontage around their boundary can admit project partners there; plots at
/// street fidelity, see `participant_slots_at`.
pub fn participant_slots(holding: &super::fabric::Holding) -> Vec<Slot> {
    participant_slots_at(holding, TownScale::default())
}
/// The partner plots round a holding's boundary, sized at `scale`.
pub fn participant_slots_at(holding: &super::fabric::Holding, scale: TownScale) -> Vec<Slot> {
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
            .flat_map(|ring| edge_slots(&holding.slot, holding.id, ring, scale))
            .collect(),
        atlas_map::Geometry::MultiPolygon { coordinates } => coordinates
            .iter()
            .filter_map(|polygon| polygon.first())
            .flat_map(|ring| edge_slots(&holding.slot, holding.id, ring, scale))
            .collect(),
        _ => vec![],
    }
}

fn edge_slots(
    slot: &Slot,
    participant: super::fabric::HoldingId,
    ring: &[atlas_map::Position],
    town_scale: TownScale,
) -> Vec<Slot> {
    use super::geometry::{distance, sub, unit};
    let pitch = town_scale.length(PARTNER_PITCH, Measure::Plot);
    let depth = town_scale.length(PARTNER_DEPTH, Measure::Plot);
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
        let count = (length / pitch).floor() as usize;
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
                depth,
                corners: rectangle(front, direction, inward, frontage, depth),
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
    fn only_the_inhabited_section_of_a_street_supports_a_new_branch() {
        let fronts = OccupiedFronts(vec![[vec![(20., 10.)], vec![(30., 8.)]], [vec![], vec![]]]);
        assert!(fronts.served_front(0, 25., 20.) > 10.);
        assert_eq!(fronts.served_front(0, 85., 20.), 0.);
        assert_eq!(fronts.served_front(1, 25., 20.), 0.);
    }
    #[test]
    fn a_developable_back_row_needs_neighbours_on_both_flanks_of_its_own_bank() {
        let mut slot = slots(0, &street(), 8., 24., TownScale::default()).remove(0);
        slot.along = 50.;
        slot.side = Side::Left;
        let east = vec![(39., 8.), (63., 8.)];
        let west = vec![(45., 8.)];
        let fronts = OccupiedFronts(vec![[east, west]]);
        assert!(fronts.flanks_opening(&slot));
        slot.side = Side::Right;
        assert!(!fronts.flanks_opening(&slot));
        slot.side = Side::Left;
        slot.along = 10.;
        assert!(!fronts.flanks_opening(&slot));
    }
    #[test]
    fn candidate_frontages_vary_on_both_sides_of_a_street() {
        let street = street();
        let all = slots(0, &street, 8.0, 24.0, TownScale::default());
        let left = all.iter().filter(|s| s.side == Side::Left).count();
        assert!(left > 0 && left < all.len());
        assert!(all.windows(2).any(|s| s[0].frontage != s[1].frontage));
        assert!(all.windows(2).any(|s| s[0].depth != s[1].depth));
        assert!(all
            .iter()
            .all(|s| (s.front[1].abs() - (4.0 + VERGE)).abs() < 1e-9));
    }
}
