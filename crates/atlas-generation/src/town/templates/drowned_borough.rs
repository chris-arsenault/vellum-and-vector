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

const UNDERWATER: &[Founder] = &[
    household(At::Submerged, Submerged, Household),
    work(At::Shore, Place(places::LANDING), Common, Ground),
    work(
        At::Submerged,
        Place(places::STOREHOUSE),
        Household,
        Submerged,
    ),
];

pub(super) const POLICY: Policy = Policy {
    eligible: |s| s.shore.is_some() && s.submerged.is_some(),
    habitat: |_, _, wet| if wet { Submerged } else { Ground },
    connector: |_| Some((At::Shore, At::Submerged, "ventilated diving shaft")),
    affinity: |p| match p.activity {
        Activity::Trade | Activity::Hospitality | Activity::Agriculture => p.near(At::Shore, 1.),
        _ => p.near(At::Submerged, 1.),
    },
    ..Policy::ordinary(
        "drowned-borough",
        |_| UNDERWATER,
        |s| {
            matches([
                (Axis::Water, true, 2),
                (Axis::Practice, s.practice[2] > 0., 1),
            ])
        },
    )
};
