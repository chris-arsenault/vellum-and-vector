//! Local conditions shared by proposals evaluating where to establish premises.
use super::effects::{Placement, Requirement};
use super::{
    catalogue::{AccessUse, Definition, Kind, PlaceRules, Site},
    influence::Conditions,
    network::Street,
};
/// Conditions offered to a place's siting policy at a particular frontage.
pub struct Location {
    has_frontage: bool,
    pub land: Conditions,
    pub freight: f64,
    pub through: f64,
    pub traffic: f64,
    pub trade: f64,
    pub quiet: f64,
    pub rural: f64,
}
pub fn feasible(kind: Kind, land: Conditions, street: Option<usize>) -> bool {
    (kind.definition().premises.site != Site::RequireStreet || street.is_some())
        && suitable_ground(kind, land)
}

#[derive(Default)]
pub(crate) struct PlacementInfluence {
    bars: Vec<Placement>,
    policies: Vec<fn(Placement) -> bool>,
    concessions: Vec<(Placement, Requirement, f64)>,
}
impl PlacementInfluence {
    pub(crate) fn permitted(&self, target: Placement) -> bool {
        !self.bars.iter().any(|bar| bar.matches(target))
            && self.policies.iter().all(|permit| permit(target))
    }

    pub(crate) fn requirement(&self, target: Placement, name: Requirement, regular: f64) -> f64 {
        // owner-direction(2026-11-19): Eases reduces a placement requirement for a class of later placements
        let offered = self
            .concessions
            .iter()
            .filter(|(placement, requirement, _)| placement.matches(target) && *requirement == name)
            .map(|(_, _, relief)| *relief)
            .fold(0., f64::max);
        (regular - offered).max(0.)
    }
}

impl super::fabric::Town {
    pub(crate) fn placement_at(
        &self,
        point: super::geometry::Point,
        spatial: &dyn crate::spatial::SpatialKernel,
    ) -> std::io::Result<PlacementInfluence> {
        use super::{geometry::distance, scale::Measure, settings::PREMISES_REACH};
        let [x, y] = point;
        let scale = self.scale();
        let reach = scale.length(PREMISES_REACH, Measure::Adjacency);
        let adjacent = |metres| scale.length(metres, Measure::Adjacency);
        let nearby = self.nearby_holdings(
            atlas_map::Bounds(x - reach, y - reach, x + reach, y + reach),
            spatial,
        )?;
        let mut answers = PlacementInfluence::default();
        for i in nearby {
            let h = &self.holdings()[i];
            if h.occupation <= 0. || h.condition <= 0.2 {
                continue;
            }
            let distance = distance(point, h.slot.front);
            if distance <= h.slot.depth && h.consecration >= crate::magic::hallowed::WARD_SEALS {
                answers
                    .policies
                    .push(crate::field::people::crafts::permits_on_consecrated_ground);
            }
            for kind in std::iter::once(h.kind).chain(h.secondary) {
                let effects = h.effects_as(kind);
                if distance <= h.slot.depth {
                    answers.policies.extend(effects.placement_policy);
                }
                answers.bars.extend(
                    effects
                        .bars
                        .iter()
                        .filter(|bar| distance <= adjacent(bar.reach))
                        .map(|bar| bar.target),
                );
                answers.concessions.extend(
                    effects
                        .eases
                        .iter()
                        .filter(|ease| distance <= adjacent(ease.reach))
                        .map(|ease| {
                            (
                                ease.target,
                                ease.requirement,
                                ease.relief * h.occupation * h.condition,
                            )
                        }),
                );
            }
        }
        Ok(answers)
    }
}
pub(super) fn suitable_ground(kind: Kind, land: Conditions) -> bool {
    match kind.definition().premises.site {
        Site::WorkingLand => land.cultivated > 0.,
        Site::RootedGround => land.rooted,
        Site::FlowingWater => land.flowing,
        Site::Waterfront => land.bank,
        Site::PractisedGround => land.practices.preferred().is_some(),
        Site::RequireStreet | Site::PreferStreet | Site::OpenGround => true,
    }
}

/// The street width at which a frontage's freight access is half its best. Street metres,
/// resolved by `Measure::Width`.
const HALF_FREIGHT: f64 = 2.;
impl Location {
    /// The location `along` a road, or off any road, read at `scale`.
    pub fn at(
        land: Conditions,
        road: Option<&Street>,
        along: f64,
        wear: f64,
        scale: super::scale::TownScale,
    ) -> Self {
        let width = road.map_or(0., |road| road.width_at(along));
        let freight = if AccessUse::Freight.permits_width(width, scale) {
            width / (scale.length(HALF_FREIGHT, super::scale::Measure::Width) + width)
        } else {
            0.
        };
        let through = f64::from(road.is_some_and(|street| street.through_route));
        let wear = if road.is_some() { wear } else { 0. };
        Self {
            has_frontage: road.is_some(),
            land,
            freight,
            through,
            traffic: through + wear / (1. + wear),
            trade: land.exchange / (1. + land.exchange),
            quiet: 1. / (1. + land.nuisance + land.waste),
            rural: land.cultivated / (1. + land.density),
        }
    }
    pub fn attraction(&self, definition: Definition) -> f64 {
        let land = self.land;
        let freight = self.freight;
        let access = match definition.premises.access {
            AccessUse::Waterborne => f64::from(land.bank),
            // A viable workplace can precede its supply route. Existing freight access
            // improves the site; subsequent journeys must use the actual network.
            AccessUse::Freight => 1. + freight,
            AccessUse::Foot => 1. / (1. + land.slope),
        };
        let frontage = match definition.premises.site {
            Site::PreferStreet if self.has_frontage => 1. + freight,
            Site::OpenGround | Site::WorkingLand if !self.has_frontage => 1. + self.quiet,
            _ => 1.,
        };
        access * frontage * (0.1 + (definition.attraction)(self))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::town::catalogue::PLACES;

    #[test]
    fn a_concession_changes_only_its_named_placement_requirement() {
        let target = Placement::Premises(PLACES[0]);
        let other = Placement::Premises(PLACES[1]);
        let mut influence = PlacementInfluence {
            concessions: vec![(target, Requirement::Support, 0.25)],
            ..Default::default()
        };
        assert!(influence.permitted(target));
        assert_eq!(
            influence.requirement(target, Requirement::Support, 0.5),
            0.25
        );
        assert_eq!(influence.requirement(other, Requirement::Support, 0.5), 0.5);
        influence.bars.push(target);
        assert!(!influence.permitted(target));
    }
}
