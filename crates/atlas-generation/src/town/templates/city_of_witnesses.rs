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

const WITNESSES: &[Founder] = &[
    household(At::Witness, Ground, Household),
    work(At::Witness, Place(places::LEARNING), Institutional, Ground),
    work(At::Centre, Livelihood, Household, Ground),
];

pub(super) const POLICY: Policy = Policy {
    eligible: |s| s.witness.is_some(),
    tenure: |p| match p.activity {
        Activity::Institution | Activity::Service => Institutional,
        _ => p.ordinary_tenure(),
    },
    affinity: |p| {
        if p.within(At::Witness, 1.) {
            0.
        } else {
            match p.activity {
                Activity::Institution | Activity::Hospitality | Activity::Service => {
                    p.near(At::Witness, 1.5)
                }
                _ => p.near(At::Witness, 4.),
            }
        }
    },
    ..Policy::ordinary(
        "city-of-witnesses",
        |_| WITNESSES,
        |s| {
            matches([
                (Axis::Medium, s.medium[1] > 0. || s.medium[4] > 0., 2),
                (Axis::Practice, s.practice[1] > 0. || s.practice[4] > 0., 1),
                (Axis::Civic, s.old, 1),
            ])
        },
    )
};
