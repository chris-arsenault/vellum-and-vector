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
pub(crate) fn collective_need(kind: Kind, people: f64) -> Option<impl Fn(Point, f64) -> bool> {
    let place = kind.definition();
    let requests = place.roles.civic_need?;
    let salt = place.label.bytes().map(i32::from).sum();
    Some(move |centre: Point, waste| {
        let audience = people * crate::chance::Chance::of(salt, 0).unit([centre[0], centre[1]]);
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
