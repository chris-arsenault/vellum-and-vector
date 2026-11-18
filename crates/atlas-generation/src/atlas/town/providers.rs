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
        influence::{OpportunitySource, Sources},
    },
};
use std::io;
pub fn approaches() -> Query<State, Sources> {
    Query::new("town.sources.approaches", vec![], |state: &State, _| {
        let mut sources = Vec::new();
        for town in &state.town.towns {
            for (i, arm) in town.seat.arms.iter().enumerate() {
                if let Some(position) = arm.points.last() {
                    sources.push(OpportunitySource {
                        endpoint: Endpoint::Catchment(format!("{}:approach:{i}", town.seat.key)),
                        id: format!("{}:approach:{i}", town.seat.key),
                        label: arm
                            .destination
                            .clone()
                            .unwrap_or_else(|| "rural approach".into()),
                        position: *position,
                        activity: Activity::Trade,
                        demand: town.seat.story.people.sqrt() * 0.12,
                        capability: 0.5,
                    });
                }
            }
        }
        Ok(Sources(sources))
    })
}
pub fn kept_links(state: &State) -> io::Result<Vec<crate::links::Link>> {
    let mut offers = crate::links::Offers::default();
    if let Some(magic) = &state.physical.magic {
        for field in &magic.borrow().fields {
            crate::field::people::crafts::offer_doors(&mut offers, field.doors().to_vec());
        }
    }
    offers.links(state.field())
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
                    Benefit::Sanctity => (Activity::Institution, value, 0.),
                    Benefit::Power | Benefit::Materials => (Activity::Production, 0., value),
                    Benefit::Food => (Activity::Agriculture, 0., value),
                    Benefit::Defence | Benefit::Water => (Activity::Service, 0., value),
                };
                sources.push(OpportunitySource {
                    endpoint: Endpoint::External(feature.id.clone()),
                    id: format!("{}:{}", feature.id, benefit as u8),
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
fn contextual_features(state: &State) -> io::Result<Vec<crate::features::Feature>> {
    // hpc-exempt: captured place identities, not a numerical field indexed by cell.
    let mut records = std::collections::BTreeMap::new();
    if let Some(source) = state.records.source_features.as_deref() {
        for feature in source.values(FeatureSelection::default())? {
            let feature = feature?;
            records.insert(feature.id.clone(), feature);
        }
    }
    for feature in state.records.features.values(FeatureSelection {
        area_id: Some(&state.scope.area),
        ..Default::default()
    })? {
        let feature = feature?;
        records.insert(feature.id.clone(), feature);
    }
    Ok(records.into_values().collect())
}
pub fn occupation() -> Query<State, Sources> {
    Query::new("town.sources.occupation", vec![], |state: &State, _| {
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
                    let occupation =
                        holding.occupation / (1. + f64::from(holding.secondary.is_some()));
                    sources.push(OpportunitySource {
                        endpoint: Endpoint::Premises {
                            town: town.seat.key.clone(),
                            holding: holding.id,
                        },
                        id: format!("{}:holding:{}:{}", town.seat.key, holding.id.0, i),
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
                }
            }
        }
        Ok(Sources(sources))
    })
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
                endpoint: Endpoint::Field(fields[0].id.to_string()),
                id: format!("estate:{estate}"),
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
        for (town, points) in state.town.towns.iter().zip(&requests.0) {
            let mut services = vec![Conditions::default(); points.len()];
            let fields: Vec<_> = state
                .town
                .fields
                .iter()
                .map(|f| f.outline.clone())
                .collect();
            let fields = state.spatial.index(&fields).map_err(io::Error::other)?;
            for (point, condition) in points.iter().zip(&mut services) {
                if let Some(i) = fields
                    .nearest(atlas_map::Position::xy(point[0], point[1]))
                    .map_err(io::Error::other)?
                {
                    let distance = state
                        .spatial
                        .distance(
                            &atlas_map::Geometry::Point {
                                coordinates: atlas_map::Position::xy(point[0], point[1]),
                            },
                            &state.town.fields[i].outline,
                        )
                        .map_err(io::Error::other)?;
                    condition.cultivated = state.town.fields[i].worked / (1. + distance / 60.);
                }
            }
            use crate::town::catalogue::ServiceRole;
            let providers: Vec<_> = town
                .holdings()
                .iter()
                .filter(|h| h.kind.definition().roles.service != ServiceRole::None)
                .collect();
            let origins: Vec<_> = providers.iter().map(|h| h.slot.front).collect();
            let routes = if origins.is_empty() {
                vec![]
            } else {
                crate::town::access::Access::new(town.streets(), state.spatial.as_ref())?
                    .on_ground(&requests.2)
                    .travel_costs(&origins, points, state.spatial.as_ref())?
            };
            for (holding, costs) in providers.into_iter().zip(routes) {
                let service = holding.kind.definition().roles.service;
                for (condition, cost) in services.iter_mut().zip(costs) {
                    let provision = holding.occupation * (0.2 + holding.means) / (1. + cost / 100.);
                    match service {
                        ServiceRole::Clearance => condition.clearance += provision,
                        ServiceRole::Protection => condition.protection += provision,
                        ServiceRole::None => {}
                    }
                }
            }
            let shapes: Vec<_> = town.holdings().iter().map(|h| h.outline.clone()).collect();
            let areas = shapes
                .iter()
                .map(|s| state.spatial.area(s).map_err(io::Error::other))
                .collect::<io::Result<Vec<_>>>()?;
            let index = state.spatial.index(&shapes).map_err(io::Error::other)?;
            let mut conditions = Vec::new();
            for (p, mut condition) in points.iter().zip(services) {
                let point = atlas_map::Geometry::Point {
                    coordinates: atlas_map::Position::xy(p[0], p[1]),
                };
                for i in index
                    .query(atlas_map::Bounds(
                        p[0] - 100.,
                        p[1] - 100.,
                        p[0] + 100.,
                        p[1] + 100.,
                    ))
                    .map_err(io::Error::other)?
                {
                    let holding = &town.holdings()[i];
                    let distance = state
                        .spatial
                        .distance(&point, &shapes[i])
                        .map_err(io::Error::other)?;
                    premises_effect(holding, areas[i], distance, &mut condition);
                }
                conditions.push(condition);
            }
            results.push(conditions);
        }
        Ok(SiteConditions(results))
    })
}

fn premises_effect(
    holding: &crate::town::fabric::Holding,
    area: f64,
    distance: f64,
    condition: &mut crate::town::influence::Conditions,
) {
    let exposure = holding.occupation / (1. + (distance / 15.).powi(2));
    if !holding.public {
        condition.density += area * holding.occupation / (10000. * (1. + (distance / 60.).powi(2)));
    }
    for kind in std::iter::once(holding.kind).chain(holding.secondary) {
        let definition = kind.definition();
        match definition.activity {
            Activity::Institution => condition.institutions += exposure,
            Activity::Household => condition.households += exposure,
            Activity::Production => condition.workshops += exposure,
            _ => {}
        }
        condition.nuisance += definition.nuisance * exposure;
    }
    condition.patronage += holding.means * exposure;
    if holding.kind.definition().activity == Activity::Agriculture && !holding.buildings.is_empty()
    {
        condition.rural_service += holding.occupation / (1. + distance / 60.);
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
                    endpoint: Endpoint::External(name.into()),
                    id: name.into(),
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
