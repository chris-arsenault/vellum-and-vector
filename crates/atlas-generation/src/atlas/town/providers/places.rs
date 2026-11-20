use crate::{
    field::{refinement::courses::cell_at, shared::Scalar, Field},
    rock::ground::GroundField,
    spatial::SpatialKernel,
    town::{
        access::Access,
        catalogue::Kind,
        effects::{response, Nuisance, Service},
        fabric::{Holding, HoldingId, Town},
        geometry::{dot, sub, Point},
        ground::Ground,
        influence::Conditions,
        scale::{Measure, TownScale},
        settings::{DAILY_REACH, LEARNING_REACH, PREMISES_REACH, SERVICE_CAPACITY, SERVICE_REACH},
    },
};
use std::io;

pub(super) type Membership = (Option<usize>, Option<HoldingId>);
type Diversity = Vec<(Kind, f64)>;

pub(super) fn accessible(
    town: &Town,
    points: &[Point],
    ground: &Ground,
    spatial: &dyn SpatialKernel,
    conditions: &mut [Conditions],
) -> io::Result<()> {
    let providers: Vec<_> = town.holdings().iter().filter_map(Accessible::new).collect();
    if providers.is_empty() {
        return Ok(());
    }
    let sources: Vec<_> = providers
        .iter()
        .map(|provider| provider.holding.slot.front)
        .collect();
    let mut claims = Vec::new();
    let mut learning = vec![Diversity::new(); points.len()];
    let scale = town.scale();
    let travel = |metres| scale.length(metres, Measure::Travel);
    let (service_reach, learning_reach) = (travel(SERVICE_REACH), travel(LEARNING_REACH));
    Access::for_town(town, spatial)?
        .on_ground(ground)
        .reached_within(
            &sources,
            points,
            travel(DAILY_REACH),
            spatial,
            |provider, site, cost| {
                for (kind, strength) in providers[provider].uses.iter().copied() {
                    let profile = providers[provider].holding.effects_as(kind);
                    for service in profile.serves {
                        claims.push(Claim {
                            provider,
                            site,
                            service: service.kind,
                            cost,
                            strength: strength * service.strength * response(cost, service_reach),
                        });
                    }
                    let tenure = town
                        .round
                        .saturating_sub(providers[provider].holding.established);
                    let community = strength.max(conditions[site].households * 0.1);
                    let knowledge = profile.teaches
                        * community
                        * (1. - response(f64::from(tenure) + 1., 6.))
                        * response(cost, learning_reach);
                    record(&mut learning[site], kind, knowledge);
                    for burden in profile
                        .burdens
                        .iter()
                        .filter(|b| b.kind == Nuisance::Disorder)
                    {
                        conditions[site].effects.nuisance[Nuisance::Disorder as usize] +=
                            strength * burden.strength * response(cost, learning_reach);
                    }
                }
            },
        )?;
    supply_services(town, &providers, conditions, claims);
    for (condition, learning) in conditions.iter_mut().zip(learning) {
        condition.effects.learning = learning.iter().map(|(_, strength)| strength).sum();
    }
    Ok(())
}

struct Accessible<'a> {
    holding: &'a Holding,
    uses: Vec<(Kind, f64)>,
}
impl<'a> Accessible<'a> {
    fn new(holding: &'a Holding) -> Option<Self> {
        let uses = active_uses(holding)
            .filter(|(kind, _)| {
                let profile = holding.effects_as(*kind);
                !profile.serves.is_empty()
                    || profile.teaches > 0.
                    || profile.burdens.iter().any(|b| b.kind == Nuisance::Disorder)
            })
            .collect::<Vec<_>>();
        (!uses.is_empty()).then_some(Self { holding, uses })
    }
}

fn active_uses(holding: &Holding) -> impl Iterator<Item = (Kind, f64)> {
    let share = holding.occupation * holding.condition * holding.operation_scale()
        / (1. + f64::from(holding.secondary.is_some()));
    std::iter::once(holding.kind)
        .chain(holding.secondary)
        .map(move |kind| (kind, share))
}

struct Claim {
    provider: usize,
    site: usize,
    service: Service,
    cost: f64,
    strength: f64,
}

fn supply_services(
    town: &Town,
    providers: &[Accessible<'_>],
    conditions: &mut [Conditions],
    mut claims: Vec<Claim>,
) {
    // A holding serves as many as the premises it stands for.
    let per_holding = SERVICE_CAPACITY * town.scale().premises();
    let mut capacity: Vec<_> = providers
        .iter()
        .map(|p| {
            [p.holding.occupation * p.holding.condition * p.holding.operation_scale() * per_holding;
                Service::ALL.len()]
        })
        .collect();
    let mut filled = vec![[false; Service::ALL.len()]; conditions.len()];
    // hpc-exempt: nearest available named provider serves an individual recipient.
    claims.sort_unstable_by(|a, b| {
        (a.site >= town.holdings().len())
            .cmp(&(b.site >= town.holdings().len()))
            .then(a.cost.total_cmp(&b.cost))
            .then(b.strength.total_cmp(&a.strength))
    });
    for claim in claims {
        let service = claim.service as usize;
        let available = &mut capacity[claim.provider][service];
        let need = town.holdings().get(claim.site).map_or(0., |h| h.occupation);
        if filled[claim.site][service]
            || *available <= 0.
            || *available < need
            || claim.strength <= 0.
        {
            continue;
        }
        *available -= need;
        filled[claim.site][service] = true;
        let site = &mut conditions[claim.site];
        match claim.service {
            Service::Clearance => site.clearance = claim.strength,
            Service::Protection => site.protection = claim.strength,
            Service::Care => site.effects.care = claim.strength,
        }
    }
}

#[derive(Clone, Copy, Default)]
pub(super) struct Carrier {
    height: f64,
    wind: Point,
}
impl Carrier {
    pub(super) fn at(field: &Field, point: Point) -> io::Result<Self> {
        let Some(cell) = cell_at(field.mesh(), point) else {
            return Ok(Self::default());
        };
        Ok(Self {
            height: field.ground().view(GroundField::Elevation).get(cell)?,
            wind: [
                field.shared().scalar(Scalar::WindX).get(cell)?,
                field.shared().scalar(Scalar::WindY).get(cell)?,
            ],
        })
    }
}

pub(super) struct LocalSite {
    pub point: Point,
    pub member: Membership,
    pub carrier: Carrier,
    prestige: Diversity,
    /// How far premises' frontage and nuisance carry, at the town's scale.
    reach: f64,
}
impl LocalSite {
    pub(super) fn new(
        point: Point,
        member: Membership,
        carrier: Carrier,
        scale: TownScale,
    ) -> Self {
        Self {
            point,
            member,
            carrier,
            prestige: Vec::new(),
            reach: scale.length(PREMISES_REACH, Measure::Adjacency),
        }
    }

    pub(super) fn receive(
        &mut self,
        holding: &Holding,
        source: Carrier,
        distance: f64,
        condition: &mut Conditions,
    ) {
        let (street, enclosure) = self.member;
        let frontage = street.is_some_and(|s| holding.slot.street == Some(s));
        let enclosed = enclosure.is_some_and(|owner| {
            owner == holding.id || holding.institution.or(holding.slot.participant) == Some(owner)
        });
        if enclosed || frontage || distance == 0. {
            condition.effects.consecration = condition
                .effects
                .consecration
                .max(holding.consecration * response(distance, self.reach));
        }
        let reach = self.reach;
        for (kind, share) in active_uses(holding) {
            let profile = holding.effects_as(kind);
            if frontage || enclosed {
                record(
                    &mut self.prestige,
                    kind,
                    profile.dignifies * holding.condition,
                );
            }
            for burden in profile.burdens {
                let exposure = match burden.kind {
                    Nuisance::Smoke => {
                        smoke(self.point, holding.slot.front, source.wind, distance, reach)
                    }
                    Nuisance::Noise => {
                        response(distance, reach * if enclosed { 0.25 } else { 0.4 })
                    }
                    Nuisance::Foulness => response(
                        distance,
                        reach
                            * if self.carrier.height <= source.height {
                                0.7
                            } else {
                                0.2
                            },
                    ),
                    Nuisance::Disorder => 0.,
                    Nuisance::Stigma if frontage && !enclosed => response(distance, reach),
                    Nuisance::Stigma => 0.,
                };
                condition.effects.nuisance[burden.kind as usize] +=
                    share * exposure * burden.strength;
            }
        }
    }

    pub(super) fn finish(self, condition: &mut Conditions) {
        condition.protection += condition.effects.consecration;
        let burdens = &mut condition.effects.nuisance;
        burdens[Nuisance::Foulness as usize] =
            (burdens[Nuisance::Foulness as usize] - condition.clearance).max(0.);
        burdens[Nuisance::Disorder as usize] =
            (burdens[Nuisance::Disorder as usize] - condition.protection).max(0.);
        condition.nuisance += burdens.iter().sum::<f64>();
        condition.effects.prestige = (self
            .prestige
            .iter()
            .map(|(_, strength)| strength)
            .sum::<f64>()
            - burdens[Nuisance::Stigma as usize])
            .max(0.);
    }
}

/// How much of a source's smoke reaches a point downwind, carried as far as `reach`.
fn smoke(point: Point, source: Point, wind: Point, distance: f64, reach: f64) -> f64 {
    let length = dot(wind, wind).sqrt();
    let offset = sub(point, source);
    let along = dot(offset, wind) / length.max(f64::EPSILON);
    let across = (dot(offset, offset) - along * along).max(0.).sqrt();
    let longitudinal = if along >= 0. { 1. } else { 0.25 };
    let cost = (along / longitudinal).hypot(across / 0.45).max(distance);
    response(cost, reach)
}

fn record(diversity: &mut Diversity, kind: Kind, strength: f64) {
    if strength <= 0. {
        return;
    }
    if let Some((_, previous)) = diversity
        .iter_mut()
        .find(|(family, _)| family.same_family(kind))
    {
        *previous = previous.max(strength);
    } else {
        diversity.push((kind, strength));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::town::{
        catalogue::{PlaceRules, PLACES},
        fabric::Proposal,
        geometry::rectangle,
        plots::{Side, Slot},
        seat::Seat,
    };

    #[test]
    fn smoke_reaches_farther_downwind_and_an_unreachable_service_contributes_nothing() {
        let reach = PREMISES_REACH;
        assert!(
            smoke([70., 0.], [0., 0.], [1., 0.], 70., reach)
                > smoke([-70., 0.], [0., 0.], [1., 0.], 70., reach)
        );
        assert_eq!(response(f64::INFINITY, SERVICE_REACH), 0.);
    }

    #[test]
    fn care_counts_once_and_an_exhausted_provider_yields_to_the_next() {
        let geometry = atlas_gis::geometry::NativeGeos::new(1e-6).unwrap();
        let mut town = Town::new(
            Seat {
                key: atlas_map::Id::from_name("care catchment"),
                name: "Care catchment".into(),
                centre: [0., 0.],
                story: Default::default(),
                arms: vec![],
                culture: None,
            },
            None,
        );
        let kind = PLACES
            .into_iter()
            .find(|kind| {
                kind.definition()
                    .services()
                    .iter()
                    .any(|service| service.kind == Service::Care)
            })
            .unwrap();
        let frontage = kind.definition().frontage.high;
        let depth = kind.definition().depth.high;
        for (i, occupation) in [0.05, 0.8, 1., 1.].into_iter().enumerate() {
            let x = i as f64 * (frontage + 10.);
            let front = [x, 0.];
            let id = town
                .establish(
                    Proposal {
                        kind,
                        means: 0.5,
                        priority: 1.,
                        cause: String::new(),
                        slot: Slot {
                            habitat: Default::default(),
                            tenure: Default::default(),
                            participant: None,
                            street: None,
                            side: Side::Left,
                            along: x,
                            corners: rectangle(front, [1., 0.], [0., 1.], frontage, depth),
                            front,
                            direction: [1., 0.],
                            inward: [0., 1.],
                            frontage,
                            depth,
                        },
                    },
                    &geometry,
                )
                .unwrap()
                .unwrap();
            town.occupy(id, 1., 0.5, occupation, 0.);
        }
        let providers: Vec<_> = town.holdings()[..2]
            .iter()
            .filter_map(Accessible::new)
            .collect();
        let claim = |provider, site, cost, strength| Claim {
            provider,
            site,
            cost,
            strength,
            service: Service::Care,
        };
        let mut results = [Conditions::default(); 4];
        supply_services(
            &town,
            &providers,
            &mut results,
            vec![
                claim(0, 2, 10., 0.3),
                claim(0, 3, 11., 0.2),
                claim(1, 2, 16., 0.4),
                claim(1, 3, 19., 0.35),
            ],
        );
        assert_eq!(results[2].effects.care, 0.3);
        assert_eq!(results[3].effects.care, 0.35);
    }
}
