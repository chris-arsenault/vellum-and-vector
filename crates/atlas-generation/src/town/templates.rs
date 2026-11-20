//! A site's founding evidence, feasible kernels and ranked alternatives survive in the town.
mod kernel;
mod rules;
mod streets;
use super::geometry::{dot, sub, unit, Point};
pub use kernel::{Founder, FounderUse, Habitat, Tenure};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AnchorRole {
    Centre,
    Upper,
    Lower,
    Shore,
    FarShore,
    Afloat,
    Submerged,
    Door,
    Grove,
    Witness,
    Institution,
    Industry,
    FirstApproach,
    LastApproach,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SiteEvidence {
    pub works: super::major_works::WorkLandscape,
    pub centre: Point,
    pub upper: Option<Point>,
    pub lower: Option<Point>,
    pub shore: Option<Point>,
    pub far_shore: Option<Point>,
    pub afloat: Option<Point>,
    /// An inhabitable submerged site with a surface passage established independently of Pressure.
    pub submerged: Option<Point>,
    pub door: Option<Point>,
    pub grove: Option<Point>,
    pub witness: Option<Point>,
    pub institution: Option<Point>,
    pub industry: Option<Point>,
    pub approaches: Vec<Point>,
    pub cultivated: bool,
    pub guarded: bool,
    pub seat: bool,
    pub planned: bool,
    pub old: bool,
    pub vowed: bool,
    pub free_tenure: bool,
    /// Physical presence and practiced shares follow the field craft catalog order:
    /// Fire, Aurora, Pressure, Greenwood, Salt, Hallowed, Veil.
    pub medium: [f64; 7],
    pub practice: [f64; 7],
}
impl SiteEvidence {
    pub fn point(&self, role: AnchorRole) -> Option<Point> {
        match role {
            AnchorRole::Centre => Some(self.centre),
            AnchorRole::Upper => self.upper,
            AnchorRole::Lower => self.lower,
            AnchorRole::Shore => self.shore,
            AnchorRole::FarShore => self.far_shore,
            AnchorRole::Afloat => self.afloat,
            AnchorRole::Submerged => self.submerged,
            AnchorRole::Door => self.door,
            AnchorRole::Grove => self.grove,
            AnchorRole::Witness => self.witness,
            // Founders can establish a hall or a workshop for the first time.
            AnchorRole::Institution => Some(self.institution.unwrap_or(self.centre)),
            AnchorRole::Industry => Some(self.industry.unwrap_or(self.centre)),
            AnchorRole::FirstApproach => self.approaches.first().copied(),
            // Pick the approach most opposed to the first; survey order need not be geographic.
            AnchorRole::LastApproach => {
                let first = self.point(AnchorRole::FirstApproach)?;
                let heading = unit(sub(first, self.centre));
                self.approaches.iter().skip(1).copied().min_by(|a, b| {
                    let angle = |p| dot(heading, unit(sub(p, self.centre)));
                    angle(*a).total_cmp(&angle(*b))
                })
            }
        }
    }
    fn opposing_ways(&self) -> bool {
        self.point(AnchorRole::FirstApproach)
            .zip(self.point(AnchorRole::LastApproach))
            .is_some_and(|(a, b)| dot(unit(sub(a, self.centre)), unit(sub(b, self.centre))) < -0.35)
    }
}

/// Each entry owns one complete policy. Generation stores the stable template identity.
// owner-direction(2026-11-19): settlement types own their policies and recurring processes do not switch on settlement type.
macro_rules! templates {
    ($($variant:ident => $owner:ident),+ $(,)?) => {
        $(mod $owner;)+
        #[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
        #[serde(rename_all = "kebab-case")]
        pub enum Template { $($variant),+ }
        impl Template {
            pub const ALL: [Self; [$(stringify!($variant)),+].len()] = [$(Self::$variant),+];
            fn policy(self) -> &'static rules::Policy {
                match self { $(Self::$variant => &$owner::POLICY),+ }
            }
        }
    }
}
templates! {
    Commons => ferry_commons,
    Stronghold => cliff_citadel,
    Landings => two_landings,
    Moorings => moored_flotilla,
    Depths => drowned_borough,
    Keeper => door_port,
    Grove => orchard_of_households,
    Ring => surveyors_ring,
    Vow => sanctuary_of_the_vow,
    Compound => walled_household_state,
    Compact => republic_of_refuge,
    Exchange => treaty_market,
    Witnesses => city_of_witnesses,
    Guilds => commonwealth_of_guilds,
}

impl Template {
    pub fn name(self) -> &'static str {
        self.policy().name
    }
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|template| template.name() == name)
    }
    fn candidate(self, site: &SiteEvidence) -> Candidate {
        let reasons = (self.policy().matches)(site);
        let weight = 1 + reasons
            .iter()
            .map(|reason| u32::from(reason.strength))
            .sum::<u32>();
        Candidate {
            template: self,
            weight,
            reasons,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Axis {
    Relief,
    Water,
    Access,
    Occupation,
    Civic,
    Institution,
    Medium,
    Practice,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Match {
    pub axis: Axis,
    pub strength: u8,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Candidate {
    pub template: Template,
    pub weight: u32,
    pub reasons: Vec<Match>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Selection {
    pub selected: Template,
    pub ranked: Vec<Candidate>,
    pub site: SiteEvidence,
}
impl Selection {
    pub fn commons(centre: Point) -> Self {
        let site = SiteEvidence {
            centre,
            ..Default::default()
        };
        Self {
            selected: Template::Commons,
            ranked: vec![Template::Commons.candidate(&site)],
            site,
        }
    }
    // owner-direction(2026-11-19): rank settlement templates from initial conditions and choose randomly with greater weight toward the top.
    pub fn choose(site: SiteEvidence, draw: f64) -> Self {
        let mut ranked: Vec<_> = Template::ALL
            .into_iter()
            .filter(|t| (t.policy().eligible)(&site))
            .map(|t| t.candidate(&site))
            .collect();
        ranked.sort_by_key(|c| std::cmp::Reverse(c.weight));
        let mut selection = Self {
            selected: Template::Commons,
            ranked,
            site,
        };
        selection.selected = selection
            .draw_remaining(draw, &[])
            .expect("the road commons always has a viable kernel");
        selection
    }
    pub fn draw_remaining(&self, draw: f64, excluded: &[Template]) -> Option<Template> {
        let eligible = self
            .ranked
            .iter()
            .filter(|c| !excluded.contains(&c.template));
        let total = eligible.clone().map(|c| c.weight).sum::<u32>();
        if total == 0 {
            return None;
        }
        let mut ticket = ((draw.clamp(0., 1.) * f64::from(total)) as u32).min(total - 1);
        for candidate in eligible {
            if ticket < candidate.weight {
                return Some(candidate.template);
            }
            ticket -= candidate.weight;
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::town::catalogue::Activity;

    #[test]
    fn ineligible_kernels_never_enter_the_draw() {
        let mut site = SiteEvidence {
            shore: Some([2., 0.]),
            upper: Some([0., 20.]),
            guarded: true,
            free_tenure: true,
            approaches: vec![[20., 0.], [35., 1.]],
            ..Default::default()
        };
        site.medium[2] = 1.;
        site.practice[2] = 1.;
        let choices = Selection::choose(site.clone(), 0.).ranked;
        let available = |kind| choices.iter().any(|c| c.template == kind);
        // One ledge, nearby Pressure, and a road approaching twice from the
        // same side supply none of the missing physical or social capabilities.
        for kind in [
            Template::Landings,
            Template::Depths,
            Template::Moorings,
            Template::Compound,
            Template::Exchange,
        ] {
            assert!(!available(kind));
        }
        site.lower = Some([0., 0.]);
        site.afloat = Some([3., 2.]);
        site.submerged = Some([4., 4.]);
        site.approaches.push([-30., 0.]);
        let ranked = Selection::choose(site, 0.).ranked;
        for kind in [
            Template::Landings,
            Template::Depths,
            Template::Moorings,
            Template::Exchange,
        ] {
            assert!(ranked.iter().any(|c| c.template == kind));
        }
    }

    #[test]
    fn the_ranked_choices_drive_the_weighted_draw() {
        let site = SiteEvidence {
            upper: Some([3., 8.]),
            lower: Some([0., 0.]),
            approaches: vec![[10., 0.]],
            guarded: true,
            ..Default::default()
        };
        let ranked = Selection::choose(site.clone(), 0.).ranked;
        assert!(ranked.windows(2).all(|p| p[0].weight >= p[1].weight));
        let total = ranked.iter().map(|c| c.weight).sum::<u32>();
        let mut start = 0;
        for candidate in ranked {
            for ticket in start..start + candidate.weight {
                let draw = (f64::from(ticket) + 0.5) / f64::from(total);
                assert_eq!(
                    Selection::choose(site.clone(), draw).selected,
                    candidate.template
                );
            }
            start += candidate.weight;
        }
    }

    #[test]
    fn shared_site_has_different_rights_and_connectors_under_different_charters() {
        let mut charter = Selection::commons([0., 0.]);
        charter.site.upper = Some([10., 0.]);
        charter.site.lower = Some([-10., 0.]);
        charter.selected = Template::Landings;
        assert_eq!(
            charter.connector(),
            Some((AnchorRole::Lower, AnchorRole::Upper, "incline lift"))
        );
        assert_eq!(charter.habitat([12., 1.], false), Habitat::Upper);
        charter.selected = Template::Compound;
        assert_eq!(charter.affinity(Activity::Household, [5., 5.], 10.), 0.);
        assert_eq!(
            charter.tenure(Activity::Household, [50., 0.], 10.),
            Tenure::Dependent
        );
        charter.selected = Template::Compact;
        assert!(charter.affinity(Activity::Household, [5., 5.], 10.) > 0.);
        assert_eq!(
            charter.tenure(Activity::Household, [50., 0.], 10.),
            Tenure::Common
        );
        charter.selected = Template::Ring;
        assert_eq!(charter.affinity(Activity::Trade, [30., 0.], 10.), 0.);
        assert_eq!(charter.align([30., 0.]), Some([0., 1.]));
    }

    #[test]
    fn a_failed_kernel_leaves_its_alternatives_in_their_original_proportions() {
        let selection = Selection::choose(SiteEvidence::default(), 0.);
        let excluded = [selection.ranked[0].template];
        let rest = &selection.ranked[1..];
        let total = rest.iter().map(|c| c.weight).sum::<u32>();
        for choice in rest {
            let drawn = (0..total)
                .filter(|&i| {
                    selection.draw_remaining((f64::from(i) + 0.5) / f64::from(total), &excluded)
                        == Some(choice.template)
                })
                .count();
            assert_eq!(drawn, choice.weight as usize);
        }
        assert_eq!(selection.draw_remaining(1., &Template::ALL), None);
    }
}
