//! Opportunities can have substitute providers and complementary uses.
use super::catalogue::{AccessUse, Operation};
use super::scale::TownScale;

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Deserialize, serde::Serialize,
)]
pub enum Origin {
    Holding(u32, u32),
    Approach(u32),
}

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Deserialize, serde::Serialize,
)]
pub enum Opportunity {
    UnfinishedCloth,
    PreparedCloth,
    TextileCommission,
    RoughStone,
    ShapedStone,
    MasonryCommission,
    PreparedTimber,
    Rigging,
    VesselWork,
    MetalStock,
    PreparedMetal,
    MetalworkCommission,
    WorkedHeat,
    WitnessRecord,
    Soundings,
    SpringWater,
}
impl Opportunity {
    const COUNT: usize = Self::SpringWater as usize + 1;
}

#[derive(Clone, Copy, Debug)]
pub struct Offer {
    pub opportunity: Opportunity,
    pub strength: f64,
    pub uses: Option<Opportunity>,
}
impl Offer {
    pub const fn new(opportunity: Opportunity, strength: f64) -> Self {
        Self {
            opportunity,
            strength,
            uses: None,
        }
    }

    pub const fn when_supplied(opportunity: Opportunity, strength: f64, uses: Opportunity) -> Self {
        Self {
            opportunity,
            strength,
            uses: Some(uses),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Need {
    pub opportunity: Opportunity,
    pub operation: Operation,
    pub access: &'static [AccessUse],
    pub handling: f64,
}
impl Need {
    pub const fn new(
        opportunity: Opportunity,
        operation: Operation,
        access: &'static [AccessUse],
        handling: f64,
    ) -> Self {
        Self {
            opportunity,
            operation,
            access,
            handling,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Production {
    pub offers: &'static [Offer],
    pub needs: &'static [Need],
}

/// Best reachable equivalent provider for each opportunity and mode at a candidate site.
#[derive(Clone)]
pub struct Available([[f64; 3]; Opportunity::COUNT]);

impl Default for Available {
    fn default() -> Self {
        Self([[0.; 3]; Opportunity::COUNT])
    }
}
impl Available {
    /// An offer reached by `mode` at this travel cost, read at `scale`.
    pub fn receive(
        &mut self,
        opportunity: Opportunity,
        mode: AccessUse,
        offer: f64,
        cost: f64,
        scale: TownScale,
    ) {
        let available = &mut self.0[opportunity as usize][mode as usize];
        *available = available.max(strength(offer, cost, scale));
    }

    pub fn support(&self, needs: &[Need]) -> f64 {
        needs
            .iter()
            .map(|need| {
                need.access
                    .iter()
                    .map(|&mode| self.0[need.opportunity as usize][mode as usize])
                    .fold(0., f64::max)
                    / (1. + need.handling / 100.)
            })
            .sum()
    }
}

fn strength(offer: f64, cost: f64, scale: TownScale) -> f64 {
    offer * super::influence::pull(cost, scale)
}

pub(crate) fn partner(
    need: Need,
    paths: &[super::influence::Reachable<'_>],
    mode: AccessUse,
    previous: Option<&super::fabric::OperatingTie>,
    scale: TownScale,
) -> Option<super::fabric::OperatingTie> {
    if !need.access.contains(&mode) {
        return None;
    }
    paths
        .iter()
        .filter(|p| p.source.productive == Some(need.opportunity))
        .filter_map(|p| {
            let strength =
                strength(p.source.capability, p.cost, scale) / (1. + need.handling / 100.);
            let custom = previous
                .filter(|tie| tie.destination == p.source.endpoint)
                .map_or(0., |tie| tie.strength);
            (strength > 0.).then_some((p, strength, strength * (1. + custom / (1. + custom))))
        })
        .max_by(|a, b| a.2.total_cmp(&b.2))
        .map(|(path, strength, _)| super::fabric::OperatingTie {
            purpose: need.operation,
            destination: path.source.endpoint.clone(),
            entrance: path.source.position,
            access: mode,
            strength,
            productive: Some(need.opportunity),
            clientele: None,
        })
}

pub(crate) fn compare_partners(
    needs: &[Need],
    paths: &[super::influence::Reachable<'_>],
    mode: AccessUse,
    previous: &[super::fabric::OperatingTie],
    selected: &mut [Option<super::fabric::OperatingTie>],
    scale: TownScale,
) {
    for (need, choice) in needs.iter().zip(selected) {
        let old = previous
            .iter()
            .find(|tie| tie.productive == Some(need.opportunity));
        *choice = choice
            .take()
            .into_iter()
            .chain(partner(*need, paths, mode, old, scale))
            .max_by(|a, b| a.strength.total_cmp(&b.strength));
    }
}

pub(crate) fn retain_partners(
    choices: Vec<Option<super::fabric::OperatingTie>>,
    ties: &mut Vec<super::fabric::OperatingTie>,
) -> f64 {
    let mut partners = Vec::<super::fabric::OperatingTie>::new();
    for choice in choices.into_iter().flatten() {
        if let Some(same) = partners
            .iter_mut()
            .find(|p| p.productive == choice.productive && p.purpose == choice.purpose)
        {
            if choice.strength > same.strength {
                *same = choice;
            }
        } else {
            partners.push(choice);
        }
    }
    let work = partners.iter().map(|p| p.strength).sum();
    ties.extend(partners);
    work
}

/// Wares offered by an inter-settlement trading connection. Local bulk
/// supply and commissions come from operating sites instead.
pub(crate) const TRADABLE: &[Offer] = &[
    Offer::new(Opportunity::UnfinishedCloth, 0.42),
    Offer::new(Opportunity::PreparedCloth, 0.54),
    Offer::new(Opportunity::PreparedMetal, 0.43),
    Offer::new(Opportunity::Rigging, 0.38),
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::town::{
        catalogue::Activity,
        fabric::Endpoint,
        influence::{OpportunitySource, Reachable, SourceId},
    };

    fn supplier(label: &str, product: Opportunity, strength: f64) -> OpportunitySource {
        let id = atlas_map::Id::from_name(label);
        OpportunitySource {
            id: SourceId::Named(id),
            endpoint: Endpoint::External(id),
            label: label.into(),
            position: [0., 0.],
            activity: Activity::Trade,
            demand: 0.,
            capability: strength,
            productive: Some(product),
            clientele: None,
        }
    }

    #[test]
    fn a_yard_can_switch_routes_and_suppliers_without_accepting_a_different_product() {
        let weave = supplier("weavers", Opportunity::UnfinishedCloth, 0.9);
        let import = supplier("importer", Opportunity::UnfinishedCloth, 0.6);
        let finished = supplier("cloth merchant", Opportunity::PreparedCloth, 1.2);
        let scale = TownScale::default();
        let need = Need::new(
            Opportunity::UnfinishedCloth,
            Operation::Supply,
            &[AccessUse::Foot, AccessUse::Freight],
            12.,
        );
        let local = partner(
            need,
            &[Reachable {
                source: &weave,
                cost: 25.,
                competitors: 0.,
            }],
            AccessUse::Foot,
            None,
            scale,
        )
        .unwrap();
        let paths = [
            Reachable {
                source: &weave,
                cost: f64::INFINITY,
                competitors: 0.,
            },
            Reachable {
                source: &finished,
                cost: 20.,
                competitors: 0.,
            },
            Reachable {
                source: &import,
                cost: 70.,
                competitors: 0.,
            },
        ];
        let replaced = partner(need, &paths, AccessUse::Freight, Some(&local), scale).unwrap();
        assert_eq!(replaced.destination, import.endpoint);
        assert!(partner(need, &paths[..2], AccessUse::Freight, Some(&local), scale).is_none());
        let cutting = Need {
            opportunity: Opportunity::PreparedCloth,
            ..need
        };
        assert_eq!(
            partner(cutting, &paths[..2], AccessUse::Freight, None, scale)
                .unwrap()
                .destination,
            finished.endpoint
        );
    }
}
