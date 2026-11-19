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

const REFUGE: &[Founder] = &[
    household(At::Centre, Ground, Common),
    work(At::Centre, Place(places::ASSEMBLY_HALL), Common, Ground),
    work(At::Centre, Livelihood, Household, Ground),
];

pub(super) const POLICY: Policy = Policy {
    eligible: |s| s.old || s.guarded,
    tenure: |p| match p.activity {
        Activity::Household | Activity::Institution | Activity::Service => Common,
        _ => p.ordinary_tenure(),
    },
    affinity: |p| match p.activity {
        Activity::Household | Activity::Service => p.near(At::Centre, 2.),
        Activity::Institution => p.near(At::Centre, 1.),
        _ => 1.,
    },
    ..Policy::ordinary(
        "republic-of-refuge",
        |_| REFUGE,
        |s| {
            matches([
                (Axis::Civic, s.old || s.guarded, 2),
                (Axis::Access, s.opposing_ways(), 1),
            ])
        },
    )
};
