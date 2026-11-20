use super::{
    kernel::{household, work},
    rules::{matches, Policy},
    AnchorRole as At, Axis, Founder,
    FounderUse::{Livelihood, Place},
    Habitat::*,
    Tenure::*,
};
use crate::town::catalogue::founding_places as places;

const RING: &[Founder] = &[
    household(At::Centre, Ground, Household),
    work(At::Centre, Place(places::COMMON), Common, Ground),
    work(At::Centre, Livelihood, Household, Ground),
];

fn spacing(unit: f64) -> f64 {
    4. * unit
}

pub(super) const POLICY: Policy = Policy {
    alignment: |s, p| {
        Some(crate::town::geometry::left(super::unit(super::sub(
            p, s.centre,
        ))))
    },
    affinity: |p| {
        let [x, y] = super::sub(p.point, p.site.centre);
        let radius = x.hypot(y);
        if x.abs().min(y.abs()) < 0.28 * p.unit || radius < p.unit {
            return 0.;
        }
        let gap = spacing(p.unit);
        let arc = (radius / gap).round().max(1.);
        0.5 + 3. / (1. + (radius - arc * gap).abs() / p.unit)
    },
    streets: |town| {
        let unit = town.plot().1;
        super::streets::occupied_arcs(town, unit, spacing(unit))
    },
    ..Policy::ordinary(
        "surveyors-ring",
        |_| RING,
        |s| {
            matches([
                (Axis::Relief, s.upper.is_none(), 1),
                (Axis::Civic, s.planned || s.seat, 2),
            ])
        },
        // The charter's rings, every four quarters, become ring roads on a city map.
        super::rules::CityLevel { quarter: 200. },
    )
};
