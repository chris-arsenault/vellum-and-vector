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

const TREATY: &[Founder] = &[
    household(At::FirstApproach, Ground, Household),
    household(At::LastApproach, Ground, Household),
    work(At::Centre, Place(places::EXCHANGE_HALL), Common, Ground),
];

pub(super) const POLICY: Policy = Policy {
    eligible: super::SiteEvidence::opposing_ways,
    connector: |_| Some((At::FirstApproach, At::LastApproach, "treaty way")),
    tenure: |p| {
        if p.within(At::Centre, 3.)
            && matches!(
                p.activity,
                Activity::Trade | Activity::Hospitality | Activity::Service
            )
        {
            Common
        } else {
            p.ordinary_tenure()
        }
    },
    affinity: |p| match p.activity {
        Activity::Trade | Activity::Hospitality | Activity::Institution => p.near(At::Centre, 1.),
        _ => p
            .near(At::FirstApproach, 1.)
            .max(p.near(At::LastApproach, 1.)),
    },
    ..Policy::ordinary(
        "treaty-market",
        |_| TREATY,
        |s| {
            matches([
                (Axis::Access, true, 2),
                (Axis::Institution, s.institution.is_some(), 1),
            ])
        },
    )
};
