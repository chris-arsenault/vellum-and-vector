//! Domain providers register economic sources; receiving processes never inspect POI kinds.
use crate::town::catalogue::PlaceRules;
use crate::town::fabric::Endpoint;
use crate::{
    atlas::state::State,
    execution::Query,
    features::FeatureSelection,
    field::{poi::values::Benefit, refinement::courses::cell_at},
    town::{
        catalogue::Activity,
        effects::Clientele,
        influence::{OpportunitySource, SourceId, Sources},
        production::{Offer, Origin, TRADABLE},
    },
};
use std::io;
mod places;
pub fn approaches() -> Query<State, Sources> {
    Query::new("town.sources.approaches", vec![], |state: &State, _| {
        let mut sources = Vec::new();
        for town in &state.town.towns {
            for (i, arm) in town.seat.arms.iter().enumerate() {
                if let Some(position) = arm.points.last() {
                    sources.push(OpportunitySource {
                        productive: None,
                        clientele: Some(if arm.destination.is_some() {
                            Clientele::Travellers
                        } else {
                            Clientele::Countryfolk
                        }),
                        endpoint: Endpoint::Catchment {
                            town: town.seat.key,
                            arm: i as u32,
                        },
                        id: SourceId::Approach {
                            town: town.seat.key,
                            arm: i as u32,
                        },
                        label: arm
                            .destination
                            .clone()
                            .unwrap_or_else(|| "rural approach".into()),
                        position: *position,
                        activity: Activity::Trade,
                        demand: town.seat.story.people.sqrt() * 0.12,
                        capability: 0.5,
                    });
                    if let Some(destination) = &arm.destination {
                        let base = sources
                            .last()
                            .expect("approach source was just inserted")
                            .clone();
                        sources.extend(imports(state, &base, town.seat.key, i as u32, destination));
                    }
                }
            }
        }
        Ok(Sources(sources))
    })
}
fn imports(
    state: &State,
    base: &OpportunitySource,
    town: atlas_map::Id,
    arm: u32,
    destination: &str,
) -> Vec<OpportunitySource> {
    let counterpart = state
        .town
        .towns
        .iter()
        .find(|other| other.seat.key != town && other.seat.name == destination);
    let Some(exporter) = counterpart else {
        // A captured route without an explicit exporter has an inferred cargo.
        let supplier = atlas_map::Id::from_name(destination).0;
        let offer = TRADABLE[(supplier % TRADABLE.len() as u128) as usize];
        return vec![productive(base, town, Origin::Approach(arm), offer, 1.)];
    };
    let mut exports = Vec::new();
    for holding in exporter.holdings().iter().filter(|h| h.occupation > 0.) {
        for kind in std::iter::once(holding.kind).chain(holding.secondary) {
            let production = holding.production_as(kind);
            exports.extend(
                production
                    .offers
                    .iter()
                    .filter(|offer| {
                        can_supply(holding, **offer)
                            && TRADABLE.iter().any(|p| p.opportunity == offer.opportunity)
                    })
                    .map(|offer| {
                        productive(
                            base,
                            town,
                            Origin::Approach(arm),
                            *offer,
                            holding.occupation * holding.condition,
                        )
                    }),
            );
        }
    }
    exports
}
pub fn kept_links(state: &State) -> io::Result<Vec<crate::links::Link>> {
    let Some(magic) = &state.physical.magic else {
        return Ok(Vec::new());
    };
    // hpc-exempt: sparse occupied or abandoned keeper locations condition known door endpoints.
    let mut keepers = std::collections::BTreeMap::<usize, f64>::new();
    let mesh = state.field().mesh();
    for h in state.town.towns.iter().flat_map(|t| t.holdings()) {
        if h.practice().is_some_and(|craft| craft.town.maintains_door) {
            if let Some(cell) = cell_at(mesh, h.slot.front) {
                let current = keepers.entry(cell).or_default();
                *current = current.max(h.occupation * h.condition);
            }
        }
    }
    let mut links = Vec::new();
    for world in &magic.borrow().fields {
        links.extend(crate::field::people::crafts::kept_doors_with(
            state.field(),
            world.doors(),
            |cell| {
                let direct = keepers.get(&cell).copied();
                let nearby = (0..3).filter_map(|edge| {
                    mesh.neighbor(cell, edge)
                        .and_then(|c| keepers.get(&c).copied())
                });
                direct.into_iter().chain(nearby).max_by(f64::total_cmp)
            },
        )?);
    }
    Ok(links)
}
pub fn institutions() -> Query<State, Sources> {
    Query::new("town.sources.places", vec![], |state: &State, _| {
        let mut sources = Vec::new();
        for feature in contextual_features(state)? {
            let Some(offers) = state.catalogue.offers_for(&feature) else {
                continue;
            };
            if state
                .town
                .towns
                .iter()
                .any(|town| town.seat.key == feature.id)
            {
                continue;
            }
            let point = state
                .spatial
                .interior_position(&feature.geometry)
                .map_err(io::Error::other)?;
            let [x, y, _] = point.coordinates();
            let Some(cell) = cell_at(state.field().mesh(), [x, y]) else {
                continue;
            };
            let values = offers(state, cell)?;
            for (benefit, value) in values {
                if value <= 0. {
                    continue;
                }
                let (activity, demand, capability) = match benefit {
                    Benefit::Trade => (Activity::Trade, value, 0.),
                    Benefit::Sanctity | Benefit::Rule | Benefit::Learning => {
                        (Activity::Institution, value, 0.)
                    }
                    Benefit::Power | Benefit::Materials => (Activity::Production, 0., value),
                    Benefit::Food => (Activity::Agriculture, 0., value),
                    Benefit::Defence | Benefit::Water => (Activity::Service, 0., value),
                };
                sources.push(OpportunitySource {
                    productive: None,
                    clientele: matches!(benefit, Benefit::Trade).then_some(Clientele::Travellers),
                    endpoint: Endpoint::External(feature.id),
                    id: SourceId::External {
                        feature: feature.id,
                        benefit: benefit as u8,
                    },
                    label: feature.name.clone(),
                    position: [x, y],
                    activity,
                    demand,
                    capability,
                });
            }
        }
        Ok(Sources(sources))
    })
}
pub(super) fn contextual_features(state: &State) -> io::Result<Vec<crate::features::Feature>> {
    // hpc-exempt: captured place identities, not a numerical field indexed by cell.
    let mut records = std::collections::BTreeMap::new();
    if let Some(source) = state.records.source_features.as_deref() {
        for feature in source.values(FeatureSelection::default())? {
            let feature = feature?;
            records.insert(feature.id, feature);
        }
    }
    for feature in state.records.features.values(FeatureSelection {
        area_id: Some(state.scope.area),
        ..Default::default()
    })? {
        let feature = feature?;
        records.insert(feature.id, feature);
    }
    Ok(records.into_values().collect())
}
pub fn occupation() -> Query<State, Sources> {
    Query::new("town.sources.occupation", vec![], |state: &State, _| {
        let magic = state.physical.magic.as_ref().map(|m| m.borrow());
        let systems = magic.as_ref().map_or(&[][..], |m| m.fields.as_slice());
        let mut sources = Vec::new();
        for town in &state.town.towns {
            for holding in town
                .holdings()
                .iter()
                .filter(|h| h.occupation > 0. && h.condition > 0.2)
            {
                for (i, kind) in std::iter::once(holding.kind)
                    .chain(holding.secondary)
                    .enumerate()
                {
                    let definition = kind.definition();
                    let mut supplied = true;
                    let active = if definition.roles.keeps {
                        let field = state.field();
                        if let Some((craft, cell)) = holding
                            .practice()
                            .zip(cell_at(field.mesh(), holding.slot.front))
                        {
                            supplied = crate::field::people::crafts::working_material(
                                field, craft, systems, cell,
                            )?;
                            crate::field::people::crafts::practised(field, craft, cell)? > 0.
                                || craft.town.effects.consecrates > 0.
                        } else {
                            false
                        }
                    } else {
                        true
                    };
                    if !active {
                        continue;
                    }
                    let occupation =
                        holding.occupation / (1. + f64::from(holding.secondary.is_some()));
                    sources.push(OpportunitySource {
                        productive: None,
                        clientele: definition
                            .roles
                            .household
                            .then_some(if holding.means >= 0.6 {
                                Clientele::Wealthy
                            } else {
                                Clientele::Townsfolk
                            }),
                        endpoint: Endpoint::Premises {
                            town: town.seat.key,
                            holding: holding.id,
                        },
                        id: SourceId::Holding {
                            town: town.seat.key,
                            holding: holding.id.0,
                            kind: i as u32,
                        },
                        label: format!("{} on {}", definition.label, town.seat.name),
                        position: holding.slot.front,
                        activity: definition.activity,
                        demand: occupation * holding.condition * definition.demand,
                        capability: if definition.activity == Activity::Production {
                            occupation * holding.condition * 0.1
                        } else {
                            0.
                        },
                    });
                    let base = sources
                        .last()
                        .expect("holding source was just inserted")
                        .clone();
                    sources.extend(
                        holding
                            .production_as(kind)
                            .offers
                            .iter()
                            .filter(|offer| supplied && can_supply(holding, **offer))
                            .map(|offer| {
                                productive(
                                    &base,
                                    town.seat.key,
                                    Origin::Holding(holding.id.0, i as u32),
                                    *offer,
                                    occupation * holding.condition * holding.operation_scale(),
                                )
                            }),
                    );
                }
            }
        }
        Ok(Sources(sources))
    })
}
fn can_supply(holding: &crate::town::fabric::Holding, offer: Offer) -> bool {
    offer
        .uses
        .is_none_or(|need| holding.ties.iter().any(|tie| tie.productive == Some(need)))
}
fn productive(
    owner: &OpportunitySource,
    town: atlas_map::Id,
    origin: Origin,
    offer: Offer,
    scale: f64,
) -> OpportunitySource {
    OpportunitySource {
        id: SourceId::Productive {
            town,
            origin,
            opportunity: offer.opportunity,
        },
        demand: 0.,
        capability: offer.strength * scale,
        productive: Some(offer.opportunity),
        clientele: None,
        ..owner.clone()
    }
}
pub fn agriculture() -> Query<State, Sources> {
    Query::new("town.sources.agriculture", vec![], |state: &State, _| {
        // hpc-exempt: groups related geometric plots into working land holdings.
        let mut estates = std::collections::BTreeMap::<u32, Vec<_>>::new();
        for field in &state.town.fields {
            estates.entry(field.estate).or_default().push(field);
        }
        let mut sources = Vec::new();
        for (estate, fields) in estates {
            let area = fields
                .iter()
                .map(|f| state.spatial.area(&f.outline).map_err(io::Error::other))
                .sum::<io::Result<f64>>()?;
            let point = state
                .spatial
                .interior_position(&fields[0].outline)
                .map_err(io::Error::other)?
                .coordinates();
            sources.push(OpportunitySource {
                productive: None,
                clientele: Some(Clientele::Countryfolk),
                endpoint: Endpoint::Field(fields[0].id),
                id: SourceId::Estate(estate),
                label: "Working fields and pasture".into(),
                position: [point[0], point[1]],
                activity: Activity::Agriculture,
                demand: area.sqrt() / 80.,
                capability: 0.,
            });
        }
        Ok(Sources(sources))
    })
}

pub(super) fn material_uses(state: &State) -> Vec<crate::field::magic::TownUse> {
    let mesh = state.field().mesh();
    state
        .town
        .towns
        .iter()
        .flat_map(|town| {
            town.holdings()
                .iter()
                .filter(|h| h.occupation > 0.)
                .flat_map(move |receiver| {
                    receiver.ties.iter().filter_map(move |tie| {
                        let product = tie.productive?;
                        let Endpoint::Premises { town: key, holding } = tie.destination else {
                            return None;
                        };
                        let provider = (key == town.seat.key)
                            .then(|| town.holdings().get(holding.0 as usize))
                            .flatten()?;
                        let craft = provider.practice()?;
                        if provider.occupation <= 0. || craft.town.material?.offered_as != product {
                            return None;
                        }
                        Some(crate::field::magic::TownUse {
                            craft,
                            source: cell_at(mesh, provider.slot.front)?,
                            receiver: cell_at(mesh, receiver.slot.front)?,
                            work: receiver.occupation * tie.strength,
                        })
                    })
                })
        })
        .collect()
}
// owner-direction(2026-11-17): support these kinds of effects in a generic extensible manner.
pub fn compose<S: 'static>(providers: Vec<Query<S, Sources>>) -> Query<S, Sources> {
    let dependencies = providers.iter().map(Query::dependency).collect();
    Query::new("town.sources", dependencies, move |_, reader| {
        let mut sources = Vec::new();
        for provider in &providers {
            sources.extend(reader.get(provider)?.0.iter().cloned());
        }
        Ok(Sources(sources))
    })
}

pub fn use_exposure() -> Query<State, crate::town::influence::SiteConditions> {
    use crate::town::influence::{Conditions, SiteConditions};
    Query::new("town.exposure.use", vec![], |state: &State, reader| {
        let requests = reader.input::<super::development::SiteRequests>()?;
        let mut results = Vec::new();
        for (town, request) in state.town.towns.iter().zip(&requests.towns) {
            let points = &request.points;
            let reach = Reach::of(town.scale());
            let mut services = vec![Conditions::default(); points.len()];
            let fields: Vec<_> = state
                .town
                .fields
                .iter()
                .map(|f| f.outline.clone())
                .collect();
            let fields = state.spatial.index(&fields).map_err(io::Error::other)?;
            for (point, condition) in points.iter().zip(&mut services) {
                if let Some((i, distance)) = fields
                    .nearest_with_distance(atlas_map::Position::xy(point[0], point[1]))
                    .map_err(io::Error::other)?
                {
                    condition.cultivated =
                        state.town.fields[i].worked / (1. + distance / reach.neighbourhood);
                }
            }
            let shapes: Vec<_> = town.holdings().iter().map(|h| h.outline.clone()).collect();
            let areas = shapes
                .iter()
                .map(|s| state.spatial.area(s).map_err(io::Error::other))
                .collect::<io::Result<Vec<_>>>()?;
            let index = state.spatial.index(&shapes).map_err(io::Error::other)?;
            let carriers = town
                .holdings()
                .iter()
                .map(|h| places::Carrier::at(state.field(), h.slot.front))
                .collect::<io::Result<Vec<_>>>()?;
            let mut sites = Vec::with_capacity(points.len());
            for (site, &p) in points.iter().enumerate() {
                let mut local = places::LocalSite::new(
                    p,
                    request.memberships[site],
                    places::Carrier::at(state.field(), p)?,
                    town.scale(),
                );
                let r = reach.premises;
                for (i, distance) in index
                    .distances(
                        atlas_map::Bounds(p[0] - r, p[1] - r, p[0] + r, p[1] + r),
                        atlas_map::Position::xy(p[0], p[1]),
                    )
                    .map_err(io::Error::other)?
                {
                    let holding = &town.holdings()[i];
                    premises_effect(holding, areas[i], distance, reach, &mut services[site]);
                    local.receive(holding, carriers[i], distance, &mut services[site]);
                }
                sites.push(local);
            }
            if request.needs_services {
                places::accessible(
                    town,
                    points,
                    &requests.ground,
                    state.spatial.as_ref(),
                    &mut services,
                )?;
            }
            for (site, condition) in sites.into_iter().zip(&mut services) {
                site.finish(condition);
            }
            let conditions = services;
            results.push(conditions);
        }
        Ok(SiteConditions(results))
    })
}

/// How far a holding's presence carries to the sites round it, at a town's scale: its
/// neighbours, its neighbourhood, and the box a site's premises are gathered from.
#[derive(Clone, Copy)]
struct Reach {
    neighbours: f64,
    neighbourhood: f64,
    premises: f64,
    /// The ground a holding's built area is spread over to read as density: a hectare at
    /// street fidelity, as much more as the neighbourhood reaches further.
    spread: f64,
}
impl Reach {
    /// The distances at which a holding's neighbours and its neighbourhood feel it half as
    /// strongly as at its door, and the half side of the box gathered round a site. Street
    /// metres, resolved by `Measure::Adjacency`.
    const NEIGHBOURS: f64 = 15.;
    const NEIGHBOURHOOD: f64 = 60.;
    const PREMISES: f64 = 100.;
    fn of(scale: crate::town::scale::TownScale) -> Self {
        let adjacent = |metres| scale.length(metres, crate::town::scale::Measure::Adjacency);
        Self {
            neighbours: adjacent(Self::NEIGHBOURS),
            neighbourhood: adjacent(Self::NEIGHBOURHOOD),
            premises: adjacent(Self::PREMISES),
            spread: scale.area(Self::HECTARE, crate::town::scale::Measure::Adjacency),
        }
    }
    /// A hectare in square metres: the ground density is read over at street fidelity.
    const HECTARE: f64 = 10_000.;
}
fn premises_effect(
    holding: &crate::town::fabric::Holding,
    area: f64,
    distance: f64,
    reach: Reach,
    condition: &mut crate::town::influence::Conditions,
) {
    let exposure = holding.occupation / (1. + (distance / reach.neighbours).powi(2));
    if !holding.public {
        // Density is built ground over the neighbourhood that gathers it: a hectare at street
        // fidelity, the same share of ground at every fidelity.
        condition.density += area * holding.occupation
            / (reach.spread * (1. + (distance / reach.neighbourhood).powi(2)));
    }
    for kind in std::iter::once(holding.kind).chain(holding.secondary) {
        let definition = kind.definition();
        match definition.activity {
            Activity::Institution => condition.institutions += exposure,
            Activity::Household => condition.households += exposure,
            Activity::Production => condition.workshops += exposure,
            _ => {}
        }
    }
    condition.patronage += holding.means * exposure;
    if holding.kind.definition().activity == Activity::Agriculture && !holding.buildings.is_empty()
    {
        condition.rural_service += holding.occupation / (1. + distance / reach.neighbourhood);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution::{Command, CommandKind, Executor};
    #[test]
    fn another_provider_extends_the_query_and_mutation_invalidates_it() {
        fn provider(name: &'static str, multiplier: f64) -> Query<f64, Sources> {
            Query::new(name, vec![], move |state: &f64, _| {
                Ok(Sources(vec![OpportunitySource {
                    productive: None,
                    clientele: None,
                    endpoint: Endpoint::External(atlas_map::Id::from_name(name)),
                    id: SourceId::Named(atlas_map::Id::from_name(name)),
                    label: name.into(),
                    position: [0., 0.],
                    activity: Activity::Trade,
                    demand: *state * multiplier,
                    capability: 0.,
                }]))
            })
        }
        let providers = vec![provider("approaches", 1.), provider("institution", 2.)];
        let query = compose(providers.clone());
        let mut executor = Executor::new(3.);
        for provider in &providers {
            executor.select(provider);
        }
        executor.select(&query);
        assert_eq!(
            executor
                .query(&query)
                .unwrap()
                .0
                .iter()
                .map(|s| s.demand)
                .sum::<f64>(),
            9.
        );
        executor
            .run(&Command::new(
                "change",
                CommandKind::Work,
                vec![],
                |state: &mut f64, _| {
                    *state = 4.;
                    Ok(())
                },
            ))
            .unwrap();
        assert_eq!(
            executor
                .query(&query)
                .unwrap()
                .0
                .iter()
                .map(|s| s.demand)
                .sum::<f64>(),
            12.
        );
    }
}
