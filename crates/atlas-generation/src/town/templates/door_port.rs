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

const DOOR: &[Founder] = &[
    household(At::Door, Ground, Institutional),
    work(At::Door, Place(places::EXCHANGE_HALL), Common, Ground),
];

pub(super) const POLICY: Policy = Policy {
    eligible: |s| s.door.is_some(),
    tenure: |p| {
        if p.activity == Activity::Service {
            Institutional
        } else {
            p.ordinary_tenure()
        }
    },
    affinity: |p| match p.activity {
        Activity::Trade | Activity::Hospitality | Activity::Service => p.near(At::Door, 1.),
        _ => p.near(At::Door, 4.),
    },
    ..Policy::ordinary(
        "door-port",
        |_| DOOR,
        |s| {
            matches([
                (Axis::Practice, true, 2),
                (Axis::Access, !s.approaches.is_empty(), 1),
                (Axis::Institution, s.institution.is_some(), 1),
            ])
        },
        // The door's quarter of yards and hostels stays close to the post.
        super::rules::CityLevel { quarter: 250. },
    )
};
