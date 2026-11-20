//! Development offered by settlement places in response to conditions at a particular site.
use super::{Kind, PlaceRules, PLACES};
use crate::town::geometry::Point;
use crate::town::influence::Conditions;

pub struct HousingSite {
    /// The scale of the town the site belongs to, which its offers read lengths through.
    pub scale: crate::town::scale::TownScale,
    pub conditions: Conditions,
    pub distance_from_seat: f64,
    pub trade_demand: f64,
    pub means: f64,
    pub form_sample: f64,
    pub livelihood_sample: f64,
}
pub type HousingOffer = fn(&HousingSite) -> bool;

pub struct CivicConditions {
    pub audience: f64,
    pub waste: f64,
}
pub(crate) fn collective_need(kind: Kind, people: f64, centre: Point, waste: f64) -> bool {
    let place = kind.definition();
    place.roles.civic_need.is_some_and(|requests| {
        let salt = place.label.bytes().map(i32::from).sum();
        let audience = people * crate::noise::hash_unit(salt, centre[0], centre[1]);
        requests(&CivicConditions { audience, waste })
    })
}

pub(crate) fn housing_offers() -> Vec<(Kind, HousingOffer)> {
    PLACES
        .iter()
        .filter_map(|&kind| {
            kind.definition()
                .roles
                .housing_offer
                .map(|offer| (kind, offer))
        })
        .collect()
}
pub(crate) fn household(site: &HousingSite, offers: &[(Kind, HousingOffer)]) -> Kind {
    if let Some(&(kind, _)) = offers.iter().find(|(_, offer)| offer(site)) {
        return kind;
    }
    super::household::select_household(site)
}
