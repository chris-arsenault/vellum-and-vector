use super::{Binding, OwnerInputs, Region};
use crate::{
    atlas::{
        assembly,
        regional::{begin::Capture, work::CapturedGround},
        state::State,
    },
    field::{
        inheritance::resources::Resource,
        people::{facts::Facts, feed::Market},
        poi::carry::Outcomes,
        refinement::people::{Parent, PlaceSettings},
    },
    scale::{MapScale, RelativeMeasure},
};
use std::io;

pub(super) fn create(
    state: &State,
    binding: &Binding,
    input: &OwnerInputs<'_, '_>,
    region: &Region,
) -> io::Result<assembly::Region> {
    if !region.parent_span.is_finite() || region.parent_span <= 0.0 {
        return Err(io::Error::other(
            "Regional generation needs the captured parent resolution",
        ));
    }
    let captured = &binding.captured.inputs;
    let mut parent_people = captured
        .parent
        .get("populationCapacity")
        .map(|source| outside_food(state, source, region.parent_span))
        .transpose()?
        .unwrap_or_default();
    if crate::field::refinement::people::enabled(&input.domains) {
        let households = captured.source("Population");
        if state.scope.city.is_some() && households.channels.contains_key("Population") {
            parent_people.census = std::rc::Rc::new(crate::field::inheritance::census_support(
                state.field().mesh(),
                state.spatial.as_ref(),
                households,
            )?);
        }
        if parent_people.market.is_none() {
            (input.progress)(
                0.0,
                "Outside food and market access are unknown for this capture",
            );
        }
        let records = state
            .records
            .source_features
            .as_deref()
            .unwrap_or(state.records.features.as_ref());
        parent_people.markets = std::rc::Rc::new(crate::field::refinement::people::markets(
            state.field(),
            records,
            state.scope.city.as_ref().map(|city| city.settlement),
        )?);
    }
    let material = captured.material();
    let channel = |name: &str| {
        material
            .channels
            .get(name)
            .map(|channel| channel.values.clone())
            .ok_or_else(|| io::Error::other(format!("Captured material requires {name}")))
    };
    Ok(assembly::Region {
        capture: Capture {
            domains: input.domains.clone(),
            parent_span: region.parent_span,
            epochs: input.epochs.len(),
            rivers: region.rivers.clone(),
        },
        seed: input.seed,
        ground: CapturedGround {
            grid: material.grid.clone(),
            bedrock: channel("BedrockElevation")?,
            share: channel("GroundCutShare")?,
            depth: channel("GroundCutDepth")?,
            has_small_channels: captured.parent.contains_key("SmallChannelLength"),
        },
        causes: state.regional_causes(input.publication.landmarks.clone()),
        outcomes: Outcomes::default(),
        ecology: input
            .epochs
            .last()
            .and_then(|epoch| epoch.ecology.clone())
            .unwrap_or_default(),
        authority: input.authority.clone(),
        places: PlaceSettings {
            last_era: region.last_era.clone(),
            town: binding.parameters.town_threshold,
            city_reach: binding.parameters.city_reach,
            road_traffic: binding.parameters.road_traffic,
            parent_span: region.parent_span,
            child_span: state.field().scale().cells(1.0),
        },
        parent_people,
    })
}

/// Sample finite supply beyond the working frame from pinned parent production and residents.
fn outside_food(state: &State, source: &Resource, parent_span: f64) -> io::Result<Parent> {
    let food = &source.channels["populationCapacity"].values;
    let residents = &source
        .channels
        .get("populationDensity")
        .ok_or_else(|| io::Error::other("Captured food production requires resident density"))?
        .values;
    let scope = &state.scope;
    let [west, south, east, north] = source.grid.bounds;
    let reach = MapScale::from_bounds([west, south, east, north], parent_span)
        .and_then(|scale| scale.resolve(RelativeMeasure::length(Facts::settled(1.0, 1.0).range)?))
        .map_err(io::Error::other)?
        .value();
    let Some(neighbourhood) = state
        .spatial
        .buffer(&scope.footprint, reach)
        .map_err(io::Error::other)?
    else {
        return Ok(Parent {
            market: Some(Market::default()),
            ..Parent::default()
        });
    };
    let atlas_map::Bounds(west, _, east, _) = state.field().mesh().bounds();
    let centre = state.field().mesh().origin()[0] + (west + east) * 0.5;
    let grid = &source.grid;
    let mut candidates = Vec::new();
    let mut points = Vec::new();
    for cell in 0..grid.measures.len() {
        if source.active.get(cell)? == 0 || residents.get(cell)? <= 0.0 {
            continue;
        }
        let [mut x, y] = grid.position(cell)?;
        if let Some(period) = grid.periodic_width {
            x += ((centre - x) / period).round() * period;
        }
        candidates.push(cell);
        points.push(atlas_map::Position::xy(x, y));
    }
    let within_reach = state
        .spatial
        .covers_points(&neighbourhood, &points)
        .map_err(io::Error::other)?;
    let inside = state
        .spatial
        .covers_points(&scope.footprint, &points)
        .map_err(io::Error::other)?;
    let mut market = Market::default();
    let mesh = state.field().mesh();
    let [ox, oy] = mesh.origin();
    let mut connections = Vec::new();
    for (((cell, position), reachable), local) in candidates
        .into_iter()
        .zip(points)
        .zip(within_reach)
        .zip(inside)
    {
        if reachable && !local {
            let [x, y, _] = position.coordinates();
            let Some(edge) = mesh.edge_cell(x - ox, y - oy) else {
                continue;
            };
            let [ex, ey] = mesh.position(edge);
            let access =
                crate::field::people::reach::passed_on((x - ox - ex).hypot(y - oy - ey), reach);
            let area = grid.measures.get(cell)? / 1e6 * access;
            let balance = (food.get(cell)? - residents.get(cell)?) * area;
            market.surplus += balance.max(0.0);
            market.demand += (-balance).max(0.0);
            connections.push(crate::field::people::feed::Connection {
                cell: edge,
                area_km2: area,
                customers: residents.get(cell)? * area,
                balance: Market {
                    surplus: balance.max(0.0),
                    demand: (-balance).max(0.0),
                },
            });
        }
    }
    Ok(Parent {
        market: Some(market),
        connections: std::rc::Rc::new(connections),
        ..Parent::default()
    })
}
