//! Present-ground allocation among cells connected by the travel network.
use super::{destinations, Leaving};
use crate::{
    execution::{CommandContext, ExecutionResult},
    field::{
        people::{
            facts, growth, hazards,
            questions::Questions,
            work::{habitable, km2, working, Work},
        },
        Field,
    },
    human::{
        catalogue::LayerId,
        operations::{self, Move},
    },
    storage::Band,
};
use std::io;

/// Exchange between accessible cells until their represented stock per unit of suitability
/// approaches the same level. Several senders share the destination's available room.
pub(in crate::field::people) fn distribute(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    owner: &operations::Operations<Field>,
    kind: LayerId,
    stock: &crate::storage::ReadBand<f64>,
    suitability: &Band<f64>,
) -> ExecutionResult<()> {
    let field = context.state();
    let available = |cell| {
        if !crate::human::catalogue::facts(kind).area {
            return Ok(f64::INFINITY);
        }
        let reserved = if kind == LayerId::BuiltUp {
            0.0
        } else {
            field
                .people
                .view(crate::human::HumanField::Layer(LayerId::BuiltUp))
                .get(cell)?
        };
        Ok((1.0 - reserved - stock.get(cell)?).max(0.0))
    };
    let placement = placement(field, work, stock, suitability, available)?;
    if crate::human::catalogue::facts(kind).area {
        return context.run(
            &owner.place_land,
            &operations::LandPlacement {
                kind,
                movement: operations::LandMovement::Local(placement),
            },
        );
    }
    context.run(
        &owner.move_layer,
        &Move {
            kind,
            targets: placement.targets,
            share: placement.share,
            years: 0.0,
        },
    )
}

pub(in crate::field::people) fn placement(
    field: &Field,
    work: &Work,
    stock: &crate::storage::ReadBand<f64>,
    suitability: &Band<f64>,
    available: impl Fn(usize) -> io::Result<f64>,
) -> io::Result<operations::Placement> {
    let count = field.mesh.len();
    let targets = field.coverage.borrow_mut().scratch(count, -1);
    let mut leaving = Leaving {
        targets,
        share: working(field),
        journeys: Vec::new(),
    };
    let mut arriving = working(field);
    let mut room = working(field);
    for cell in 0..count {
        let here = stock.get(cell)?;
        if here <= 0.0 {
            continue;
        }
        let weight = suitability.get(cell)?;
        let mut best = 0.0;
        let mut destination = None;
        for to in destinations(field, work, suitability, cell)?.0 {
            let there = suitability.get(to.cell)?;
            if there <= 0.0 {
                continue;
            }
            let a = km2(field, cell);
            let b = km2(field, to.cell);
            let balanced = exchange([here, stock.get(to.cell)?], [weight, there], [a, b]);
            let transferable = balanced.min(available(to.cell)? * b);
            let benefit = transferable * to.passed;
            if benefit > best {
                best = benefit;
                destination = Some((to.cell, transferable));
            }
        }
        if let Some((target, available)) = destination {
            let residents = here * km2(field, cell);
            leaving.request(
                cell,
                target,
                0.5 * best / residents,
                residents,
                &mut arriving,
            )?;
            room.set(target, room.get(target)?.max(available))?;
        }
    }
    leaving.admit(&arriving, |to| room.get(to))?;
    Ok(operations::Placement {
        targets: leaving.targets.read_only(),
        share: leaving.share.read_only(),
    })
}

fn exchange(density: [f64; 2], suitability: [f64; 2], area: [f64; 2]) -> f64 {
    let [from, to] = suitability;
    let [a, b] = area;
    let capacity = to * b + from * a;
    if capacity <= 0.0 {
        return 0.0;
    }
    ((density[0] * to - density[1] * from) * a * b / capacity).max(0.0)
}

fn livelihoods(
    food: f64,
    market: f64,
    attraction: f64,
    built: f64,
    guidance: f64,
    risk: f64,
) -> f64 {
    let jobs = guidance
        * (facts::WORKABLE * market.powi(2) * attraction + built * facts::PEOPLE_PER_BUILT_KM2);
    (food.sqrt() + jobs * (1.0 + food).ln_1p()) / (1.0 + risk)
}

pub(super) fn place(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    q: &Questions,
    owner: &operations::Operations<Field>,
    residents: &crate::storage::ReadBand<f64>,
    settings: super::PlacementSettings,
) -> ExecutionResult<()> {
    // owner-direction(2026-11-21): people on finer maps roughly match the parent's because people's refinement processes produce roughly equal counts, as other refinement processes do
    let livable = context.query(&q.livable)?.values();
    let support = context.query(&q.support)?.values();
    let draw = context.query(&q.draw)?.values();
    let field = context.state();
    let built = field
        .people
        .view(crate::human::HumanField::Layer(LayerId::BuiltUp));
    let ways = field.people.view(crate::human::HumanField::KeptLine);
    let city_affinity = work
        .city
        .as_deref()
        .map(|g| growth::affinities(field, g))
        .transpose()?;
    let mut opportunity = working(field);
    for cell in 0..field.mesh.len() {
        if !habitable(field, cell)? {
            continue;
        }
        let market = field.goods_turnover(cell)?;
        let food = (support.get(cell)? + work.imports.get(cell)?).max(0.0);
        let existing = residents.get(cell)?;
        let attraction = if existing > 0.0 {
            draw.get(cell)? / existing
        } else {
            1.0
        };
        let mut edge = built.get(cell)?;
        if city_affinity.is_some() {
            for side in 0..3 {
                if let Some(to) = field.mesh.neighbor(cell, side) {
                    edge = edge.max(built.get(to)?);
                }
            }
            edge *= 1.0 + ways.get(cell)?.ln_1p();
        }
        let guidance = city_affinity.as_ref().map_or(1.0, |values| values[cell]);
        let risk = hazards::exposure(field, cell)?;
        opportunity.set(
            cell,
            livable.get(cell)? * livelihoods(food, market, attraction, edge, guidance, risk),
        )?;
    }
    trace_distribution(field, "before gathering")?;
    if let Some(city) = work
        .city
        .as_ref()
        .filter(|c| c.census.len() == field.mesh.len())
    {
        let sites = super::catchments::sites(field, work, city, residents, &opportunity)?;
        context.run(
            &owner.place_households,
            &super::catchments::placement(&sites, settings),
        )?;
        trace_distribution(context.state(), "after gathering")?;
        return Ok(());
    }
    for face in 0..3 {
        place_across_face(context, work, owner, &opportunity, face)?;
    }
    let residents = context
        .state()
        .people
        .view(crate::human::HumanField::Layer(LayerId::Population));
    distribute(
        context,
        work,
        owner,
        LayerId::Population,
        &residents,
        &opportunity,
    )?;
    if context.state().process_site().map_type == crate::field::people::contract::MapType::Region
        && !work.markets.is_empty()
    {
        let transfers = super::settlements::households(context.state(), work)?;
        context.run(&owner.place_households, &transfers)?;
    }
    trace_distribution(context.state(), "after gathering")?;
    Ok(())
}

fn neighbour_exchange(heads: [f64; 2], weights: [f64; 2], areas: [f64; 2]) -> f64 {
    0.5 * (exchange(heads, weights, areas)
        - exchange(
            [heads[1], heads[0]],
            [weights[1], weights[0]],
            [areas[1], areas[0]],
        ))
}

fn place_across_face(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    owner: &operations::Operations<Field>,
    opportunity: &Band<f64>,
    face: usize,
) -> ExecutionResult<()> {
    // owner-direction(2026-11-25): household refinement smooths parent cell edges through local placement.
    // Exchange across each face orientation. Otherwise a household's single best
    // distant offer can mask every smaller imbalance across its immediate boundary.
    let field = context.state();
    let current = field
        .people
        .view(crate::human::HumanField::Layer(LayerId::Population));
    let mut targets = field.coverage.borrow_mut().scratch(field.mesh.len(), -1);
    let mut share = working(field);
    for a in 0..field.mesh.len() {
        if field.mesh.inverted(a) || !habitable(field, a)? {
            continue;
        }
        let Some(b) = field.mesh.neighbor(a, face) else {
            continue;
        };
        if !habitable(field, b)? {
            continue;
        }
        let passage = super::step_passed(work, a, face)?;
        let heads = [current.get(a)?, current.get(b)?];
        let weights = [opportunity.get(a)?, opportunity.get(b)?];
        let areas = [km2(field, a), km2(field, b)];
        let moved = neighbour_exchange(heads, weights, areas);
        let (from, to, stock) = if moved > 0. {
            (a, b, heads[0] * areas[0])
        } else if moved < 0. {
            (b, a, heads[1] * areas[1])
        } else {
            continue;
        };
        targets.set(from, to as i32)?;
        share.set(from, moved.abs() / stock * passage)?;
    }
    context.run(
        &owner.move_layer,
        &Move {
            kind: LayerId::Population,
            targets: targets.read_only(),
            share: share.read_only(),
            years: 0.,
        },
    )?;
    Ok(())
}

fn trace_distribution(field: &Field, stage: &str) -> io::Result<()> {
    if std::env::var_os("ATLAS_TRACE_PEOPLE").is_none() {
        return Ok(());
    }
    let atlas_map::Bounds(w, s, e, n) = field.mesh.bounds();
    let [ox, oy] = field.mesh.origin();
    let centre = [ox + (w + e) * 0.5, oy + (s + n) * 0.5];
    let built = field
        .people
        .view(crate::human::HumanField::Layer(LayerId::BuiltUp));
    let stock = field
        .people
        .view(crate::human::HumanField::Layer(LayerId::Standing));
    let mut totals = [0.0; 4];
    let mut urban = [0.0; 4];
    let mut capital = [0.0; 4];
    let mut total = 0.0;
    let mut squares = 0.0;
    let mut peak = 0.0_f64;
    for cell in 0..field.mesh.len() {
        let [x, y] = field.mesh.position(cell);
        let distance = (x + ox - centre[0]).hypot(y + oy - centre[1]);
        let area = km2(field, cell);
        let density = field.people.people(cell)?;
        let people = density * area;
        total += people;
        squares += people * density;
        if distance <= 5000.0 {
            peak = peak.max(people);
        }
        for (i, radius) in [2500.0, 5000.0, 10000.0, 20000.0].into_iter().enumerate() {
            if distance <= radius {
                totals[i] += people;
                urban[i] += area * built.get(cell)?;
                capital[i] += area * stock.get(cell)?;
            }
        }
    }
    eprintln!(
        "{}",
        serde_json::json!({"event":"people.spatial","stage":stage,"centre":centre,
        "radiiKm":[2.5,5,10,20],"residents":totals,"builtKm2":urban,"standing":capital,"total":total,
        "occupiedKm2": if squares>0.0 {total*total/squares} else {0.0},"peakCellWithin5km":peak})
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{exchange, livelihoods, neighbour_exchange};
    #[test]
    fn donor_steps_relax_on_equal_ground_but_a_real_opportunity_gradient_remains() {
        let moved = neighbour_exchange([1000., 100.], [1., 1.], [1., 1.]);
        assert!(moved > 0. && 1000. - moved > 100. + moved);
        assert_eq!(neighbour_exchange([1000., 100.], [10., 1.], [1., 1.]), 0.);
        assert!(neighbour_exchange([100., 100.], [1., 3.], [1., 1.]) > 0.);
    }
    #[test]
    fn even_household_stock_responds_to_market_access_development_and_exposure() {
        let country = livelihoods(50.0, 0.5, 1.0, 0.01, 1.0, 0.0);
        let residents = [99.0, 100.0];
        let flow = |market, built, hazard| {
            exchange(
                residents,
                [country, livelihoods(50.0, market, 1.0, built, 1.0, hazard)],
                [1.0, 1.0],
            )
        };
        let served = flow(2.0, 0.05, 0.1);
        assert!(served > flow(0.5, 0.05, 0.1));
        assert!(served > flow(2.0, 0.01, 0.1));
        assert!(served > flow(2.0, 0.05, 1.0));
        assert_eq!(flow(0.5, 0.01, 0.0), 0.0);
    }
}
