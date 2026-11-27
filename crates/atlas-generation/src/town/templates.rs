//! A site's founding evidence, feasible kernels and ranked alternatives survive in the town.
pub mod civic;
pub(crate) mod district;
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
/// A settlement's own draw for the craft it practises everywhere: a roll on its identity
/// and the map's seed, apart from its template's and its civic order's.
pub fn craft_roll(settlement: &[u8], seed: i32) -> f64 {
    crate::field::poi::true_sizes::roll_bytes(settlement, (seed as u64).wrapping_add(0xc2af_7001))
}
/// The share of the draw that goes to practising no craft everywhere, beside each
/// craft's own weight: its medium's presence and twice its practised share.
const NO_CITY_CRAFT: f64 = 0.5;
impl SiteEvidence {
    /// The craft a settlement on this site practises everywhere, by craft code, or none.
    /// A craft's weight is its medium's presence and twice the share already practising
    /// it; a site with neither never draws it.
    pub fn city_craft(&self, draw: f64) -> Option<i32> {
        let crafts = crate::field::people::crafts::CRAFTS;
        let weights: Vec<f64> = (0..crafts.len())
            .map(|i| self.medium[i].max(0.) + 2. * self.practice[i].max(0.))
            .collect();
        let total = NO_CITY_CRAFT + weights.iter().sum::<f64>();
        let mut ticket = draw.clamp(0., 1.) * total - NO_CITY_CRAFT;
        if ticket < 0. {
            return None;
        }
        for (craft, weight) in crafts.iter().zip(weights) {
            if ticket < weight {
                return Some(craft.code);
            }
            ticket -= weight;
        }
        None
    }
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
    /// The civic order drawn beside the template, independently of it. A policy saved
    /// before orders were drawn has none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub civic: Option<civic::Civic>,
    /// The crafts the settlement practises everywhere, by craft code: its trait as a
    /// whole place, drawn beside the template and the civic order. Every site of the
    /// settlement reads these crafts as present, so their premises and what they supply
    /// can take hold on any street.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub crafts: Vec<i32>,
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
            civic: None,
            crafts: Vec::new(),
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
            civic: None,
            crafts: Vec::new(),
        };
        selection.selected = selection
            .draw_remaining(draw, &[])
            .expect("the road commons always has a viable kernel");
        selection
    }
    /// Draws the craft the settlement practises everywhere, if any, on a draw of its own:
    /// likelier the stronger its medium lies and the more it is already practised at the
    /// site, and often none. The creator may ask for one.
    pub fn with_craft(mut self, asked: Option<i32>, draw: f64) -> Self {
        self.crafts = asked
            .or_else(|| self.site.city_craft(draw))
            .into_iter()
            .collect();
        self
    }
    /// Draws the settlement's civic order from the same site evidence, on a draw of its
    /// own, unless the creator asks for one.
    pub fn with_civic(mut self, asked: Option<civic::Civic>, draw: f64) -> Self {
        self.civic = Some(asked.unwrap_or_else(|| civic::Civic::draw(&self.site, draw)));
        self
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
    fn a_settlement_draws_the_craft_it_practises_everywhere_from_its_own_media() {
        use crate::field::people::crafts::{PracticeReads, CRAFTS};
        let (fire, veil) = (CRAFTS[0].code, CRAFTS[6].code);
        let draws = |site: &SiteEvidence| -> Vec<Option<i32>> {
            (0..100)
                .map(|step| site.city_craft((f64::from(step) + 0.5) / 100.))
                .collect()
        };
        // A site with no medium and no practice practises nothing everywhere.
        assert!(draws(&SiteEvidence::default()).iter().all(Option::is_none));
        // A site on a stable tear, with some hearth-keepers, is most often a city of
        // doors, sometimes a city of fire and sometimes neither.
        let mut site = SiteEvidence::default();
        site.medium[6] = 1.;
        site.practice[0] = 0.2;
        let drawn = draws(&site);
        let count = |craft: Option<i32>| drawn.iter().filter(|d| **d == craft).count();
        assert!(count(Some(veil)) > count(Some(fire)) && count(Some(fire)) > 0);
        assert!(count(None) > 0 && count(Some(veil)) + count(Some(fire)) + count(None) == 100);
        // The creator may ask for one, whatever the site holds.
        let asked = Selection::choose(SiteEvidence::default(), 0.).with_craft(Some(fire), 0.9);
        assert_eq!(asked.crafts, vec![fire]);
        // Every site of a settlement reads its crafts as present, and no other craft more.
        let reads = PracticeReads::from([0., 0.1, 0., 0., 0., 0., 0.9]);
        let city = reads.with_city_crafts(&[fire, veil], 0.6, false);
        assert_eq!(city.available(fire), 0.6);
        assert_eq!(city.available(veil), 0.9);
        assert_eq!(city.available(CRAFTS[1].code), 0.1);
        // A city of tenders still needs living roots: where they are severed, tending is
        // absent however widely the city practises it, and its other craft is not.
        let tending = CRAFTS[3].code;
        let severed = PracticeReads::from([0.; 7]).with_city_crafts(&[tending, fire], 0.6, true);
        assert_eq!(severed.available(tending), 0.);
        assert_eq!(severed.available(fire), 0.6);
    }

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
    }

    #[test]
    fn ring_charters_reserve_the_centre_and_align_outer_quarters() {
        let mut charter = Selection::commons([0., 0.]);
        charter.selected = Template::Ring;
        assert_eq!(charter.affinity(Activity::Trade, [30., 0.], 10.), 0.);
        assert_eq!(charter.city_affinity(charter.site.centre), 0.);
        for outer_quarter in [[3000., 0.], [0., -3000.]] {
            assert!(charter.city_affinity(outer_quarter) > 0.);
        }
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
