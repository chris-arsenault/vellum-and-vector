use super::{
    kernel::{household, work},
    rules::{matches, Policy},
    AnchorRole as At, Axis, Founder,
    FounderUse::Place,
    Habitat::*,
    Tenure::*,
};
use crate::town::catalogue::founding_places as places;
use crate::town::catalogue::Activity;

const CLIFF: &[Founder] = &[
    household(At::Upper, Upper, Institutional),
    work(At::Upper, Place(places::WATCH), Institutional, Upper),
    work(At::Lower, Place(places::STOREHOUSE), Household, Lower),
];

pub(super) const POLICY: Policy = Policy {
    eligible: super::rules::shelves,
    habitat: super::rules::shelf_habitat,
    enclosure: Some(super::rules::Enclosure {
        anchor: At::Upper,
        radius: |s, u| {
            Some((3. * u).min(0.45 * crate::town::geometry::distance(s.upper?, s.lower?)))
        },
    }),
    connector: |_| Some((At::Lower, At::Upper, "citadel stair")),
    tenure: |p| {
        if p.activity == Activity::Institution
            && super::rules::shelf_habitat(p.site, p.point, false) == Upper
        {
            Institutional
        } else {
            p.ordinary_tenure()
        }
    },
    affinity: |p| match p.activity {
        Activity::Institution | Activity::Household => p.near(At::Upper, 1.),
        Activity::Trade | Activity::Production | Activity::Agriculture => p.near(At::Lower, 2.),
        _ => p.near(At::Lower, 1.),
    },
    ..Policy::ordinary(
        "cliff-citadel",
        |_| CLIFF,
        |s| matches([(Axis::Relief, true, 2), (Axis::Civic, s.guarded, 2)]),
        // A citadel's ledge holds a few compact quarters; suppliers spread below.
        super::rules::CityLevel { quarter: 250. },
    )
};
