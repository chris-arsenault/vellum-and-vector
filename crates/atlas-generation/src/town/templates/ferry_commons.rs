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

const ROAD_COMMONS: &[Founder] = &[
    household(At::Centre, Ground, Household),
    work(At::Centre, Livelihood, Household, Ground),
];

const FERRY: &[Founder] = &[
    work(At::Shore, Place(places::LANDING), Common, Ground),
    work(At::FarShore, Place(places::LANDING), Common, Ground),
    household(At::Shore, Ground, Household),
    work(At::Centre, Livelihood, Household, Ground),
];

pub(super) const POLICY: Policy = Policy {
    affinity: |p| {
        if matches!(p.activity, Activity::Trade | Activity::Hospitality) && p.site.shore.is_some() {
            p.near(At::Shore, 1.)
        } else {
            1.
        }
    },
    connector: |s| {
        s.shore
            .zip(s.far_shore)
            .map(|_| (At::Shore, At::FarShore, "common ferry"))
    },
    ..Policy::ordinary(
        "ferry-commons",
        |s| {
            if s.shore.is_some() && s.far_shore.is_some() {
                FERRY
            } else {
                ROAD_COMMONS
            }
        },
        |s| {
            matches([
                (Axis::Water, s.shore.is_some(), 2),
                (Axis::Occupation, s.cultivated, 2),
                (Axis::Access, !s.approaches.is_empty(), 1),
            ])
        },
        // A commons city stays loose: wide quarters strung along its ways.
        super::rules::CityLevel { quarter: 300. },
    )
};
