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

const GUILDS: &[Founder] = &[
    household(At::Industry, Ground, Household),
    work(
        At::Industry,
        Place(places::DOMESTIC_CRAFT),
        Household,
        Ground,
    ),
    work(At::Industry, Place(places::GUILD_HALL), Common, Ground),
];

pub(super) const POLICY: Policy = Policy {
    tenure: |p| match p.activity {
        Activity::Production | Activity::Institution => Institutional,
        _ => p.ordinary_tenure(),
    },
    affinity: |p| match p.activity {
        Activity::Production | Activity::Trade => p.near(At::Industry, 1.),
        Activity::Institution => p.near(At::Industry, 2.),
        _ => 1.,
    },
    ..Policy::ordinary(
        "commonwealth-of-guilds",
        |_| GUILDS,
        |s| {
            matches([
                (Axis::Institution, s.industry.is_some(), 2),
                (Axis::Access, s.approaches.len() > 1, 1),
                (Axis::Civic, s.old, 1),
            ])
        },
        // Guild jurisdictions are quarters strung along shared conduits and lanes.
        super::rules::CityLevel { quarter: 250. },
    )
};
