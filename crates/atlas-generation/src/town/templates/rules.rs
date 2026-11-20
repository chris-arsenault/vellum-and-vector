//! Contracts implemented by settlement templates at founding and on later rounds.
use super::{AnchorRole, Axis, Founder, Habitat, Match, Selection, SiteEvidence, Tenure};
use crate::town::{
    catalogue::Activity,
    fabric::Town,
    geometry::{distance, Point},
    network::StreetProposal,
};

pub(super) type Connector = (AnchorRole, AnchorRole, &'static str);
pub(super) struct Enclosure {
    pub anchor: AnchorRole,
    pub radius: fn(&SiteEvidence, f64) -> Option<f64>,
}

/// One candidate location as considered by a charter. Distances are in units
/// of the local plot depth so the same agreement can govern a hamlet or a city.
pub(super) struct Parcel<'a> {
    pub site: &'a SiteEvidence,
    pub activity: Activity,
    pub point: Point,
    pub unit: f64,
}
impl Parcel<'_> {
    pub fn near(&self, anchor: AnchorRole, target: f64) -> f64 {
        let origin = self.site.point(anchor).unwrap_or(self.site.centre);
        let error = (distance(self.point, origin) / self.unit - target).abs();
        0.5 + 3. / (1. + error)
    }
    pub fn within(&self, anchor: AnchorRole, radius: f64) -> bool {
        self.site
            .point(anchor)
            .is_some_and(|p| distance(self.point, p) < radius * self.unit)
    }
    pub fn ordinary_tenure(&self) -> Tenure {
        if self.activity == Activity::Institution {
            Tenure::Common
        } else {
            Tenure::Household
        }
    }
}
pub(super) fn matches<const N: usize>(reasons: [(Axis, bool, u8); N]) -> Vec<Match> {
    reasons
        .into_iter()
        .filter_map(|(axis, present, strength)| present.then_some(Match { axis, strength }))
        .collect()
}
pub(super) fn shelves(site: &SiteEvidence) -> bool {
    site.upper
        .zip(site.lower)
        .is_some_and(|(a, b)| distance(a, b) > 0.)
}
pub(super) fn shelf_habitat(site: &SiteEvidence, point: Point, wet: bool) -> Habitat {
    if wet {
        return Habitat::Ground;
    }
    match site.upper.zip(site.lower) {
        Some((upper, lower)) if distance(point, upper) < distance(point, lower) => Habitat::Upper,
        Some(_) => Habitat::Lower,
        None => Habitat::Ground,
    }
}

/// A template's guidance on a city map. Its layout rules are the same as on a district map,
/// read in units of its quarters instead of its plots, so a city and its districts share a
/// layout at their own size and fidelity.
pub(super) struct CityLevel {
    /// The size of the template's quarters on a city map, in metres.
    pub quarter: f64,
}
pub(super) struct Policy {
    pub name: &'static str,
    pub city: CityLevel,
    pub eligible: fn(&SiteEvidence) -> bool,
    pub matches: fn(&SiteEvidence) -> Vec<Match>,
    pub kernel: fn(&SiteEvidence) -> &'static [Founder],
    pub tenure: fn(&Parcel<'_>) -> Tenure,
    pub affinity: fn(&Parcel<'_>) -> f64,
    pub habitat: fn(&SiteEvidence, Point, bool) -> Habitat,
    pub connector: fn(&SiteEvidence) -> Option<Connector>,
    pub enclosure: Option<Enclosure>,
    pub alignment: fn(&SiteEvidence, Point) -> Option<Point>,
    pub streets: fn(&Town) -> Vec<StreetProposal>,
}
impl Policy {
    pub const fn ordinary(
        name: &'static str,
        kernel: fn(&SiteEvidence) -> &'static [Founder],
        matches: fn(&SiteEvidence) -> Vec<Match>,
        city: CityLevel,
    ) -> Self {
        Self {
            name,
            city,
            kernel,
            matches,
            eligible: |_| true,
            tenure: |p| p.ordinary_tenure(),
            affinity: |_| 1.,
            habitat: |_, _, _| Habitat::Ground,
            connector: |_| None,
            enclosure: None,
            alignment: |_, _| None,
            streets: |_| Vec::new(),
        }
    }
}
impl Selection {
    pub fn enclosure_radius(&self, unit: f64) -> Option<f64> {
        (self.selected.policy().enclosure.as_ref()?.radius)(&self.site, unit)
    }
    pub fn enclosed_seat(&self) -> Option<AnchorRole> {
        self.selected.policy().enclosure.as_ref().map(|e| e.anchor)
    }
    pub fn kernel(&self) -> &'static [Founder] {
        (self.selected.policy().kernel)(&self.site)
    }
    pub fn connector(&self) -> Option<Connector> {
        (self.selected.policy().connector)(&self.site)
    }
    pub fn habitat(&self, point: Point, wet: bool) -> Habitat {
        (self.selected.policy().habitat)(&self.site, point, wet)
    }
    pub fn align(&self, point: Point) -> Option<Point> {
        (self.selected.policy().alignment)(&self.site, point)
    }
    pub fn street_proposals(&self, town: &Town) -> Vec<StreetProposal> {
        (self.selected.policy().streets)(town)
    }
    pub fn tenure(&self, activity: Activity, point: Point, unit: f64) -> Tenure {
        (self.selected.policy().tenure)(&Parcel {
            site: &self.site,
            activity,
            point,
            unit,
        })
    }
    /// The size of the selected template's quarters on a city map, in metres.
    pub fn quarter(&self) -> f64 {
        self.selected.policy().city.quarter
    }
    /// How strongly the template draws a city's homes to a point of its city map, read in
    /// the template's quarters. Zero reserves the point, as it does a plot on a district map.
    pub fn city_affinity(&self, point: Point) -> f64 {
        self.affinity(Activity::Household, point, self.quarter())
    }
    /// Zero reserves the location independently of competing economic offers.
    pub fn affinity(&self, activity: Activity, point: Point, unit: f64) -> f64 {
        (self.selected.policy().affinity)(&Parcel {
            site: &self.site,
            activity,
            point,
            unit: unit.max(1.),
        })
    }
}
