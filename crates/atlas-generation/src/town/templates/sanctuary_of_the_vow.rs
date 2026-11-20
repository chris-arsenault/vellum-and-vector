use super::{
    kernel::{household, work},
    rules::{matches, Policy},
    AnchorRole as At, Axis, Founder,
    FounderUse::{Livelihood, Place},
    Habitat::*,
    Tenure::*,
};
use crate::town::catalogue::founding_places as places;
use crate::town::catalogue::Activity;

const VOW: &[Founder] = &[
    household(At::Institution, Ground, Institutional),
    work(
        At::Institution,
        Place(places::SHRINE),
        Institutional,
        Ground,
    ),
    work(At::Centre, Livelihood, Household, Ground),
];

pub(super) const POLICY: Policy = Policy {
    tenure: |p| {
        if p.activity == Activity::Institution {
            Institutional
        } else {
            p.ordinary_tenure()
        }
    },
    affinity: |p| match p.activity {
        Activity::Production if p.within(At::Institution, 3.) => 0.,
        Activity::Institution => p.near(At::Institution, 1.),
        Activity::Trade | Activity::Service | Activity::Hospitality => p.near(At::Institution, 3.5),
        _ => p.near(At::Institution, 5.),
    },
    ..Policy::ordinary(
        "sanctuary-of-the-vow",
        |_| VOW,
        |s| {
            matches([
                (Axis::Institution, s.institution.is_some(), 2),
                (Axis::Practice, s.vowed, 2),
                (Axis::Access, !s.approaches.is_empty(), 1),
            ])
        },
        // A wide inner precinct and an outer rim of petitioners' quarters.
        super::rules::CityLevel { quarter: 300. },
    )
};
