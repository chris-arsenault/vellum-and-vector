//! Local conditions shared by proposals evaluating where to establish premises.
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
pub(super) fn suitable_ground(kind: Kind, land: Conditions) -> bool {
    match kind.definition().premises.site {
        Site::WorkingLand => land.cultivated > 0.,
        Site::RootedGround => land.rooted,
        Site::FlowingWater => land.flowing,
        Site::Waterfront => land.bank,
        Site::PractisedGround => land.craft.is_some(),
        Site::RequireStreet | Site::PreferStreet | Site::OpenGround => true,
    }
}

impl Location {
    pub fn at(land: Conditions, road: Option<&Street>, along: f64, wear: f64) -> Self {
        let width = road.map_or(0., |road| road.width_at(along));
        let freight = if AccessUse::Freight.permits_width(width) {
            width / (2. + width)
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
