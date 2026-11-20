use super::{
    kernel::{household, work},
    rules::{matches, Policy},
    AnchorRole as At, Axis, Founder,
    FounderUse::Place,
    Habitat::*,
    Tenure::*,
};
use crate::town::catalogue::founding_places as places;

const LANDINGS: &[Founder] = &[
    household(At::Lower, Lower, Household),
    household(At::Upper, Upper, Household),
    work(At::Lower, Place(places::CARRIER_YARD), Common, Lower),
];

pub(super) const POLICY: Policy = Policy {
    eligible: super::rules::shelves,
    habitat: super::rules::shelf_habitat,
    connector: |_| Some((At::Lower, At::Upper, "incline lift")),
    affinity: |p| p.near(At::Lower, 1.).max(p.near(At::Upper, 1.)),
    ..Policy::ordinary(
        "two-landings",
        |_| LANDINGS,
        |s| {
            matches([
                (Axis::Relief, true, 2),
                (Axis::Access, !s.approaches.is_empty(), 1),
                (Axis::Institution, s.industry.is_some(), 1),
            ])
        },
        // Each level grows its own quarters about its landing.
        super::rules::CityLevel { quarter: 300. },
    )
};
