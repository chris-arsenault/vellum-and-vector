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

const COMPOUND: &[Founder] = &[
    work(At::Centre, Place(places::MANOR), Institutional, Ground),
    household(At::Centre, Ground, Dependent),
    work(At::Centre, Livelihood, Dependent, Ground),
];

pub(super) const POLICY: Policy = Policy {
    eligible: |s| !s.free_tenure && (s.seat || s.guarded),
    enclosure: Some(super::rules::Enclosure {
        anchor: At::Centre,
        radius: |_, u| Some(3. * u),
    }),
    tenure: |p| {
        if p.within(At::Centre, 3.) {
            Institutional
        } else if matches!(
            p.activity,
            Activity::Household | Activity::Production | Activity::Agriculture
        ) {
            Dependent
        } else {
            p.ordinary_tenure()
        }
    },
    affinity: |p| match p.activity {
        Activity::Household | Activity::Production | Activity::Agriculture
            if p.within(At::Centre, 3.) =>
        {
            0.
        }
        Activity::Institution => p.near(At::Centre, 1.),
        _ => p.near(At::Centre, 4.),
    },
    ..Policy::ordinary(
        "walled-household-state",
        |_| COMPOUND,
        |s| {
            matches([
                (Axis::Civic, s.guarded || s.seat, 2),
                (Axis::Occupation, s.cultivated, 1),
            ])
        },
    )
};
