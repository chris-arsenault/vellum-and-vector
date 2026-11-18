use super::{
    carry_rules, catalogue::CatalogueState, contract::*, kinds::Kind, reads, state::State,
    values::*, visibility,
};
use crate::{
    ecology::environment,
    field::{refinement::topology::distance, shared::Scalar, significance::measure},
    hpc::BitSet,
};
use std::{io, rc::Rc};

pub fn scalar(state: &impl State, name: Scalar, cell: usize) -> io::Result<f64> {
    state.field()?.shared.scalar(name).get(cell)
}
pub fn canopy(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(scalar(state, Scalar::BroadleafCover, cell)? + scalar(state, Scalar::ConiferCover, cell)?)
}
pub fn living_cover(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(scalar(state, Scalar::TreeCover, cell)?
        + scalar(state, Scalar::GrassCover, cell)?
        + scalar(state, Scalar::WetlandCover, cell)?)
}
pub fn plant_water(state: &impl State, cell: usize) -> io::Result<f64> {
    environment::plant_water(state.field()?, cell)
}
pub fn old_stand(state: &impl State, cell: usize) -> io::Result<bool> {
    reads::magic_rule(state, "greenwood", "stand", cell)
}
pub fn area(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(*state.held().get(&format!("area:{}", place.id), || {
        let mesh = &state.field()?.mesh;
        Ok(place.cells.iter().map(|&cell| mesh.area(cell)).sum::<f64>())
    })?)
}
pub fn span(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok((2.0 * state.field()?.scale.cells(1.0))
        .max((area(state, place)? / std::f64::consts::PI).sqrt()))
}
pub fn hazard_reach(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(span(state, place)?.min(state.field()?.scale.cells(32.0)))
}
pub fn mean(
    _state: &impl State,
    place: &Place,
    read: impl Fn(usize) -> io::Result<f64>,
) -> io::Result<f64> {
    let mut sum = 0.0;
    for &cell in &place.cells {
        sum += read(cell)?;
    }
    Ok(sum / place.cells.len().max(1) as f64)
}
pub fn mean_scalar(state: &impl State, place: &Place, name: Scalar) -> io::Result<f64> {
    mean(state, place, |cell| scalar(state, name, cell))
}
pub fn country_factors<S: State + 'static>(
    statement: &str,
    places: Places<S>,
    typical_area: f64,
    read: OnCell<S, f64>,
    weights: visibility::Weights,
) -> Visibility<S> {
    let magnitude: OnPlace<S, f64> = Rc::new(move |state, place| {
        Ok(visibility::sized(
            area(state, place)?,
            measure(&state.field()?.scale, typical_area, 2, 1.0)?,
        ))
    });
    let local: OnPlace<S, f64> = Rc::new(move |state, place| {
        visibility::stands_out(state, place, hazard_reach(state, place)?, |cell| {
            read(state, cell)
        })
    });
    let isolation: OnPlace<S, f64> = Rc::new(move |state, place| {
        visibility::alone_among(state, place, &places(state)?, span(state, place)?)
    });
    let cultural: OnPlace<S, f64> =
        Rc::new(|state, place| visibility::attachment(state, place, span(state, place)?));
    let (m, l, i, c) = (
        magnitude.clone(),
        local.clone(),
        isolation.clone(),
        cultural.clone(),
    );
    Visibility {
        statement: Must::Value(statement.into()),
        magnitude: Slot::Value(magnitude),
        local_conditions: Slot::Value(local),
        isolation: Slot::Value(isolation),
        cultural: Slot::Value(cultural),
        importance: Must::Value(Rc::new(move |state, place| {
            let total = weights.magnitude + weights.local_conditions + weights.isolation;
            Ok(((weights.magnitude * m(state, place)?
                + weights.local_conditions * l(state, place)?
                + weights.isolation * i(state, place)?)
                / if total == 0.0 { 1.0 } else { total })
            .max(c(state, place)?))
        })),
    }
}
pub fn fields<S>(statement: &str) -> Fields<S> {
    Fields {
        statement: Must::Value(statement.into()),
        terrain: Slot::NotApplicable("Soil processes read cover over the whole field."),
        water: Slot::NotApplicable("Soil and climate own infiltration and runoff."),
        climate: Slot::NotApplicable("Soil processes own evapotranspiration."),
        cover: Slot::NotApplicable(
            "Ecology cohorts, grazers and fire own cover; landscape reads them.",
        ),
        magic: Slot::NotApplicable("Magic feedback owns living forcings."),
    }
}
pub fn movement<S>(statement: &str) -> Movement<S> {
    Movement {
        on_foot: None,
        statement: Must::Value(statement.into()),
        roads: Slot::NotApplicable("The router reads tree density."),
        boats: Slot::NotApplicable("Rivers carry boats under their own costs."),
        drainage: Slot::NotApplicable("Surface resistance and relief read cover."),
        magic: Slot::NotApplicable("Greenwood propagation reads cover directly."),
        links: Slot::NotApplicable("Country joins no cells."),
        crosses: Slot::NotApplicable("Country creates no crossing."),
    }
}
pub fn waterless_roads(state: &impl State, place: &Place) -> io::Result<Vec<Cost>> {
    let mut costs = Vec::new();
    for &cell in &place.cells {
        if plant_water(state, cell)? < 0.25 {
            costs.push(Cost { cell, factor: 1.5 });
        }
    }
    Ok(costs)
}
pub fn holds<S>(kinds: &[Kind]) -> Vec<Relation<S>> {
    kinds
        .iter()
        .map(|&kind| Relation {
            kind,
            holds: Rc::new(|_, a, b| Ok(a.cells.contains(&b.anchor))),
        })
        .collect()
}
pub fn other_landscapes<S>(kind: Kind) -> Vec<Relation<S>> {
    holds(
        &[
            Kind::Forest,
            Kind::Grassland,
            Kind::Barren,
            Kind::EmberGrove,
            Kind::ThawMeadow,
            Kind::RimeForest,
            Kind::GlowBarrens,
            Kind::FogHeath,
            Kind::Wetland,
            Kind::Lake,
        ]
        .into_iter()
        .filter(|&other| other != kind)
        .collect::<Vec<_>>(),
    )
}
pub fn within_own<S: State + 'static>(kind: Kind, reach: OnPlace<S, f64>) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(move |state, a, b| {
            Ok(distance(&state.field()?.mesh, a.anchor, b.anchor) <= reach(state, a)?)
        }),
    }
}
pub fn near<S: State + 'static>(kind: Kind, spans: f64) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(move |state, a, b| {
            super::places::within(state, a, b, state.field()?.scale.cells(spans))
        }),
    }
}
pub fn touching(state: &impl State, a: &Place, b: &Place) -> io::Result<bool> {
    let mesh = &state.field()?.mesh;
    let members = state.held().get(&format!("members:{}", b.id), || {
        let mut members = BitSet::new(mesh.len());
        for &cell in &b.cells {
            members.add(cell);
        }
        Ok(members)
    })?;
    Ok(a.cells.iter().any(|&cell| {
        members.has(cell)
            || (0..3).any(|edge| {
                mesh.neighbor(cell, edge)
                    .is_some_and(|next| members.has(next))
            })
    }))
}
pub fn borders<S: State + 'static>(kinds: &[Kind]) -> Vec<Relation<S>> {
    kinds
        .iter()
        .map(|&kind| Relation {
            kind,
            holds: Rc::new(touching),
        })
        .collect()
}
pub fn developed_country<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    statement: &str,
    is_a: OnCell<S, bool>,
) -> AcrossMaps<S, Schedule> {
    let counterpart: OnCarried<S, Option<usize>> = Rc::new(move |state, carried| {
        carry_rules::counterpart(state, carried, state.parent_cell_span(), 2.0, |cell| {
            is_a(state, cell)
        })
    });
    let find = counterpart.clone();
    let moved: OnCarried<S, Unrealized> = Rc::new(move |state, carried| {
        Ok(match find(state, carried)? {
            Some(cell) if cell == carried.cell => Unrealized::Keep,
            Some(cell) => Unrealized::Move(cell),
            None => Unrealized::Drop,
        })
    });
    AcrossMaps {
        statement: Must::Value(statement.into()),
        stands_on: Slot::Unwritten,
        carry: Slot::Value(Rc::new(carry_rules::where_it_lands)),
        realize: Slot::NotApplicable("The child's ecology and magic develop captured cover."),
        counterpart: Slot::Value(counterpart),
        unrealized: Slot::Value(moved.clone()),
        settle: Slot::Value(moved),
        schedule: Slot::NotApplicable("Country needs no additional refinement step."),
    }
}
