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

const FLOTILLA: &[Founder] = &[
    household(At::Afloat, Floating, Household),
    work(At::Shore, Place(places::LANDING), Common, Ground),
    work(At::Afloat, Livelihood, Household, Floating),
];

pub(super) const POLICY: Policy = Policy {
    eligible: |s| s.shore.is_some() && s.afloat.is_some(),
    habitat: |_, _, wet| if wet { Floating } else { Ground },
    connector: |_| Some((At::Shore, At::Afloat, "mooring gangway")),
    affinity: |p| match p.activity {
        Activity::Agriculture | Activity::Production => p.near(At::Shore, 2.),
        _ => p.near(At::Afloat, 1.),
    },
    ..Policy::ordinary(
        "moored-flotilla",
        |_| FLOTILLA,
        |s| {
            matches([
                (Axis::Water, true, 2),
                (Axis::Access, s.opposing_ways(), 1),
                (Axis::Institution, s.industry.is_some(), 1),
            ])
        },
    )
};
