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

const ORCHARD: &[Founder] = &[
    household(At::Grove, Ground, Household),
    work(At::Grove, Place(places::GROVE), Common, Ground),
    work(At::Centre, Livelihood, Household, Ground),
];

pub(super) const POLICY: Policy = Policy {
    eligible: |s| s.grove.is_some(),
    tenure: |p| {
        if p.activity == Activity::Agriculture {
            Common
        } else {
            p.ordinary_tenure()
        }
    },
    affinity: |p| {
        if p.within(At::Grove, 1.) && p.activity != Activity::Agriculture {
            0.
        } else {
            p.near(At::Grove, 2.5)
        }
    },
    ..Policy::ordinary(
        "orchard-of-households",
        |_| ORCHARD,
        |s| {
            matches([
                (Axis::Medium, s.medium[3] > 0., 2),
                (Axis::Practice, s.practice[3] > 0., 1),
                (Axis::Occupation, s.cultivated, 2),
            ])
        },
    )
};
