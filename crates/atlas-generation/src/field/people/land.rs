// Arconis: docs/architecture/subsystems.arconis#item=pp_found — founds the first people, only on an empty map.
use super::{
    contract::{
        initial_layer, layer_strategy, Condition, Contract, Dispatch, EffectTime, MapType, Product,
        Rule, Strategy, Timing,
    },
    facts::*,
    questions::Questions,
    work::{habitable, working, Work},
};
use crate::{
    execution::{Command, CommandContext, CommandKind, ExecutionResult},
    field::Field,
    human::{
        catalogue::{self, LayerId, LayerMode},
        operations::{self, Lay, Wear},
        HumanField,
    },
};
use std::{cell::RefCell, rc::Rc};

pub type SharedWork = Rc<RefCell<Work>>;
pub struct WorkInput<S> {
    pub work: SharedWork,
    pub strategy: S,
}
pub type Demography = Strategy<(), LayerId>;
pub type Capital = Strategy<Investment, LayerId>;

pub(super) const FOUNDING: Dispatch<()> = Dispatch {
    id: "human.land.found",
    rules: &[
        Rule::new(MapType::WORLD, Some(())).during(Timing::Elapsed),
        Rule::new(MapType::WORLD, None).during(Timing::Present),
        Rule::new(MapType::REFINED, None),
    ],
};

pub const DEMOGRAPHY: Contract<(), LayerId> = Contract {
    id: "human.land.grow",
    effect: "Births and deaths during a historical interval",
    reads: &[
        Product::Layer(LayerId::Population),
        Product::NetFoodImports,
        Product::Question("livable"),
    ],
    writes: &[Product::Layer(LayerId::Population)],
    catalog_id: "human.land.grow",
    strategies: &[layer_strategy(
        "demography",
        (),
        EffectTime::Elapsed,
        LayerId::Population,
        Condition::None,
    )],
};

#[derive(Clone, Copy)]
pub enum Investment {
    Historical { area_scale: f64 },
    Spatial(LandDemand),
}
#[derive(Clone, Copy)]
pub struct LandDemand {
    pub(super) elasticity: f64,
    pub(super) area_scale: f64,
}
impl LandDemand {
    pub(super) const DEFAULT: Self = Self {
        elasticity: LAND_DEMAND.default,
        area_scale: LAND_USE.default,
    };
}
pub(crate) const LAND_DEMAND: crate::parameters::NumericParameter =
    crate::parameters::NumericParameter {
        name: "landDemandElasticity",
        unit: "exponent",
        default: 3.,
        minimum: Some(f64::MIN_POSITIVE),
        maximum: None,
        strategy: Some("built-ground"),
        map_types: &[MapType::City, MapType::Region],
    };
pub(crate) const LAND_USE: crate::parameters::NumericParameter =
    crate::parameters::NumericParameter {
        name: "developedAreaPerResidentScale",
        unit: "factor",
        default: 1.,
        strategy: None,
        map_types: &[MapType::World, MapType::City, MapType::Region],
        ..LAND_DEMAND
    };
pub(crate) fn tune(
    mut strategy: Capital,
    input: &crate::atlas::dispatch::Input,
) -> std::io::Result<Capital> {
    let scale = input.number(LAND_USE.name)?;
    match &mut strategy.algorithm {
        Investment::Historical { area_scale } => *area_scale = scale,
        Investment::Spatial(demand) => {
            demand.elasticity = input.number(LAND_DEMAND.name)?;
            demand.area_scale = scale;
        }
    }
    Ok(strategy)
}
pub const BUILT_GROUND: Contract<Investment, LayerId> = Contract {
    id: "human.land.harden",
    effect: "Allocate built land and investment where households and businesses use them",
    reads: &[
        Product::Layer(LayerId::Population),
        Product::Layer(LayerId::BuiltUp),
        Product::Layer(LayerId::Farmland),
        Product::Layer(LayerId::Pasture),
        Product::Travel,
        Product::Question("building"),
        Product::Question("wealth"),
    ],
    writes: &[
        Product::Layer(LayerId::BuiltUp),
        Product::Layer(LayerId::Standing),
        Product::Layer(LayerId::Farmland),
        Product::Layer(LayerId::Pasture),
    ],
    catalog_id: "human.land.harden",
    strategies: &[
        layer_strategy(
            "investment",
            Investment::Historical {
                area_scale: LAND_USE.default,
            },
            EffectTime::Elapsed,
            LayerId::BuiltUp,
            Condition::None,
        ),
        layer_strategy(
            "built-ground",
            Investment::Spatial(LandDemand::DEFAULT),
            EffectTime::SpatialIteration,
            LayerId::BuiltUp,
            Condition::None,
        ),
    ],
};
pub const MAINTENANCE: Contract<Investment, LayerId> = Contract {
    id: "settlement.built-maintenance",
    effect: "Keep occupied structures in repair and expose neglected stock",
    reads: &[
        Product::Layer(LayerId::Standing),
        Product::Layer(LayerId::BuiltUp),
        Product::Question("wealth"),
    ],
    writes: &[
        Product::Layer(LayerId::Standing),
        Product::Layer(LayerId::BuiltUp),
    ],
    catalog_id: "town.maintenance",
    strategies: &[
        layer_strategy(
            "historical-upkeep",
            Investment::Historical {
                area_scale: LAND_USE.default,
            },
            EffectTime::Elapsed,
            LayerId::Standing,
            Condition::None,
        ),
        layer_strategy(
            "current-condition",
            Investment::Spatial(LandDemand::DEFAULT),
            EffectTime::SpatialIteration,
            LayerId::Standing,
            Condition::None,
        ),
    ],
};
pub struct Operations {
    pub found: Command<Field, Facts>,
    pub(crate) grow: Command<Field, WorkInput<Demography>>,
    pub(crate) harden: Command<Field, WorkInput<Capital>>,
    pub(crate) maintenance: Command<Field, WorkInput<Capital>>,
}
pub fn mix(mode: LayerMode) -> catalogue::CompiledLayerMix {
    let mut values = [0.0; 7];
    values[mode as usize] = 1.0;
    catalogue::compile(values)
}
impl Operations {
    pub fn new(questions: Rc<Questions>, owner: Rc<operations::Operations<Field>>) -> Self {
        let found_q = questions.clone();
        let found_o = owner.clone();
        let grow_q = questions.clone();
        let grow_o = owner.clone();
        let maintain_q = questions.clone();
        let maintain_o = owner.clone();
        Self {
            found: Command::with_inputs(
                FOUNDING.id,
                CommandKind::Initialize,
                vec![],
                move |context, _| found(context, &found_q, &found_o),
            ),
            grow: Command::with_inputs(
                DEMOGRAPHY.id,
                CommandKind::Elapsed,
                vec![],
                move |context, input: &WorkInput<Demography>| {
                    grow(
                        context,
                        &input.work.borrow(),
                        input.strategy,
                        &grow_q,
                        &grow_o,
                    )
                },
            ),
            harden: Command::with_inputs(
                BUILT_GROUND.id,
                CommandKind::Work,
                vec![],
                move |context, input: &WorkInput<Capital>| {
                    let work = input.work.borrow();
                    let strategy = input.strategy;
                    let stock = initial_layer(context.state(), &strategy)?;
                    match strategy.algorithm {
                        Investment::Historical { area_scale } => {
                            harden(context, &work, &questions, &owner, area_scale)
                        }
                        Investment::Spatial(demand) => {
                            redistribute_stock(
                                context,
                                &work,
                                &questions,
                                &owner,
                                LayerId::BuiltUp,
                                &stock,
                            )?;
                            // owner-direction(2026-11-27): built ground is built up by processes and is not calculated after the fact.
                            if !work.markets.is_empty() {
                                let flows =
                                    super::gather::developed_land(context.state(), &work, demand)?;
                                if !flows.is_empty() {
                                    context.run(
                                        &owner.place_land,
                                        &operations::LandPlacement {
                                            kind: LayerId::BuiltUp,
                                            movement: operations::LandMovement::Surveyed(flows),
                                        },
                                    )?;
                                }
                            }
                            if work.city.is_some() {
                                let plots = super::gather::city_lots(
                                    context.state(),
                                    &work,
                                    demand.area_scale,
                                )?;
                                occupy_land(context, &owner, &plots)?;
                            }
                            Ok(())
                        }
                    }
                },
            ),
            maintenance: Command::with_inputs(
                MAINTENANCE.id,
                CommandKind::Work,
                vec![],
                move |context, input: &WorkInput<Capital>| {
                    let work = input.work.borrow();
                    let field = context.state();
                    let strategy = input.strategy;
                    let stock = initial_layer(field, &strategy)?;
                    match strategy.algorithm {
                        Investment::Spatial(_) => {
                            redistribute_stock(
                                context,
                                &work,
                                &maintain_q,
                                &maintain_o,
                                LayerId::Standing,
                                &stock,
                            )?;
                            let harm = context.query(&maintain_q.harm)?.values();
                            let field = context.state();
                            let ruins = field.people.view(HumanField::RuinedBuiltUp);
                            let mut exposure = working(field);
                            for cell in 0..field.mesh.len() {
                                if habitable(field, cell)? {
                                    let (care, risk) =
                                        upkeep_conditions(field, cell, harm.get(cell)?)?;
                                    exposure.set(
                                        cell,
                                        (1.0 + risk)
                                            / (1.0
                                                + field.people.people(cell)?.sqrt()
                                                + field.goods_turnover(cell)?
                                                + care),
                                    )?;
                                }
                            }
                            let plan = super::gather::placement(
                                field,
                                &work,
                                &ruins,
                                &exposure,
                                |cell| Ok((1.0 - ruins.get(cell)?).max(0.0)),
                            )?;
                            context.run(&maintain_o.place_ruins, &plan)
                        }
                        Investment::Historical { .. } => {
                            if !work.facts.builds {
                                return Ok(());
                            }
                            let builders = context.query(&maintain_q.building)?.values();
                            let harm = context.query(&maintain_q.harm)?.values();
                            let wealth = context.query(&maintain_q.wealth)?.values();
                            let field = context.state();
                            let built = field.people.view(HumanField::Layer(LayerId::BuiltUp));
                            let mut neglect = working(field);
                            for cell in 0..field.mesh.len() {
                                let (institutions, exposure) =
                                    upkeep_conditions(field, cell, harm.get(cell)?)?;
                                let care = field.people.people(cell)?
                                    * builders.get(cell)?
                                    * (wealth.get(cell)? + institutions);
                                let upkeep = built.get(cell)? * PEOPLE_PER_BUILT_KM2
                                    + stock.get(cell)? / catalogue::FULL_STANDING_PER_BUILT_KM2
                                        * PEOPLE_PER_BUILT_KM2;
                                if upkeep > 0.0 {
                                    neglect.set(
                                        cell,
                                        work.facts.years / BUILDING_YEARS
                                            * (1.0 + exposure - care / upkeep).max(0.0),
                                    )?;
                                }
                            }
                            context.run(
                                &maintain_o.wear,
                                &Wear {
                                    mix: mix(LayerMode::Neglect),
                                    intensity: neglect.read_only(),
                                },
                            )
                        }
                    }
                },
            ),
        }
    }
}
fn found(
    context: &mut CommandContext<'_, Field>,
    q: &Questions,
    owner: &operations::Operations<Field>,
) -> ExecutionResult<()> {
    for cell in 0..context.state().mesh.len() {
        if context.state().people.people(cell)? > 0.0 {
            return Ok(());
        }
    }
    let wild = context.query(&q.wild)?.values();
    let livable = context.query(&q.livable)?.values();
    let field = context.state();
    let mut amount = working(field);
    for cell in 0..field.mesh.len() {
        if habitable(field, cell)? {
            amount.set(cell, FOUNDERS * wild.get(cell)? * livable.get(cell)?)?;
        }
    }
    context.run(
        &owner.lay,
        &Lay {
            kind: LayerId::Population,
            amount: amount.read_only(),
        },
    )
}
fn grow(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    strategy: Demography,
    q: &Questions,
    owner: &operations::Operations<Field>,
) -> ExecutionResult<()> {
    if !work.facts.grows {
        return Ok(());
    }
    let support = context.query(&q.support)?.values();
    let harm = context.query(&q.harm)?.values();
    let livable = context.query(&q.livable)?.values();
    let field = context.state();
    let residents = initial_layer(field, &strategy)?;
    trace_refused(field, &livable)?;
    let mut born = working(field);
    let mut starved = working(field);
    let filling = (-GROWTH_RATE * work.facts.years).exp();
    let lasting = (-work.facts.years / HUNGER_YEARS).exp();
    for cell in 0..field.mesh.len() {
        let living = residents.get(cell)?;
        // Ground people cannot live on holds nobody, however well it is fed.
        let room = (support.get(cell)? + work.imports.get(cell)?) * livable.get(cell)?;
        if living <= 0.0 {
            continue;
        }
        if living < room {
            born.set(
                cell,
                room / (1.0 + (room / living - 1.0) * filling) - living,
            )?;
        } else if living > room {
            starved.set(
                cell,
                -(1.0 - (living - room) * (1.0 - lasting) / living).ln() * harm.get(cell)?,
            )?;
        }
    }
    context.run(
        &owner.lay,
        &Lay {
            kind: LayerId::Population,
            amount: born.read_only(),
        },
    )?;
    context.run(
        &owner.wear,
        &Wear {
            mix: mix(LayerMode::Starve),
            intensity: starved.read_only(),
        },
    )
}
/// The dry ground that refuses people and the people still on it, written to the server log
/// when `ATLAS_TRACE_PEOPLE` is set.
fn trace_refused(field: &Field, livable: &crate::storage::ReadBand<f64>) -> std::io::Result<()> {
    if std::env::var_os("ATLAS_TRACE_PEOPLE").is_none() {
        return Ok(());
    }
    let (mut cells, mut people) = (0, 0.0);
    for cell in 0..field.mesh.len() {
        // Ground a medium refuses outright: no one should remain on it.
        if habitable(field, cell)? && livable.get(cell)? <= 0.0 {
            cells += 1;
            people += field.people.people(cell)? * super::work::km2(field, cell);
        }
    }
    eprintln!(
        "{}",
        serde_json::json!({"event": "people.refused", "details": {
            "dryCellsRefused": cells, "peopleOnThem": people.round()}})
    );
    Ok(())
}
/// The works and wealth a built share of ground gathers toward, times what the `wealth`
/// question answers there: one for built ground alone, more where trade or anything else
/// enriches it.
fn standing_target(built: f64, wealth: f64) -> f64 {
    built.max(0.0) * catalogue::FULL_STANDING_PER_BUILT_KM2 * wealth.max(0.0)
}
fn upkeep_conditions(field: &Field, cell: usize, harm: f64) -> std::io::Result<(f64, f64)> {
    use crate::field::{poi::values::Benefit, shared::Scalar};
    let (institutions, threat) = match field.place_offers() {
        Some(offers) => (
            offers.benefit(Benefit::Rule, cell)? + offers.benefit(Benefit::Materials, cell)?,
            offers.threatened(cell)?,
        ),
        None => (0.0, 0.0),
    };
    let woods = field.shared().scalar(Scalar::TreeCover).get(cell)?.max(0.0);
    let grazing = field
        .shared()
        .scalar(Scalar::Herbivores)
        .get(cell)?
        .max(0.0);
    let exposure = super::hazards::exposure(field, cell)? + threat + woods * (1.0 + grazing);
    Ok((institutions, exposure * harm.max(0.0)))
}

fn redistribute_stock(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    questions: &Questions,
    owner: &operations::Operations<Field>,
    kind: LayerId,
    stock: &crate::storage::ReadBand<f64>,
) -> ExecutionResult<()> {
    let harm = context.query(&questions.harm)?.values();
    let builders = context.query(&questions.building)?.values();
    let field = context.state();
    let built = field.people.view(HumanField::Layer(LayerId::BuiltUp));
    let farms = field.people.view(HumanField::Layer(LayerId::Farmland));
    let pasture = field.people.view(HumanField::Layer(LayerId::Pasture));
    let mut value = working(field);
    for cell in 0..field.mesh.len() {
        if !habitable(field, cell)? {
            continue;
        }
        let market = field.goods_turnover(cell)?;
        let people = field.people.people(cell)?;
        let (institutions, risk) = upkeep_conditions(field, cell, harm.get(cell)?)?;
        let condition = (builders.get(cell)? + institutions) / (1.0 + risk);
        let heads = people * (1.0 + market.ln_1p());
        let weight = match kind {
            LayerId::Standing => built.get(cell)? * heads.sqrt() * condition,
            _ => heads * condition / (1.0 + farms.get(cell)? + pasture.get(cell)?),
        };
        value.set(cell, weight)?;
    }
    super::gather::distribute(context, work, owner, kind, stock, &value)
}
fn land_needed(labour: f64, farmland: f64, area_scale: f64) -> f64 {
    if labour <= 0. {
        return 0.;
    }
    // owner-direction(2026-11-27): change the amount of people, decrease the size of the city, or change how much land each person builds.
    let land_cost = 1_000_000. / CONSTRUCTION_M2_PER_WORKER * (1.0 + farmland) / area_scale;
    labour / (land_cost + labour)
}

/// Take vacant ground first. Where urban demand wins over working land, the
/// same amount leaves its previous use through the human owner's conversion.
fn occupy_land(
    context: &mut CommandContext<'_, Field>,
    owner: &operations::Operations<Field>,
    requested: &crate::storage::Band<f64>,
) -> ExecutionResult<()> {
    let field = context.state();
    let farms = field.people.view(HumanField::Layer(LayerId::Farmland));
    let grazing = field.people.view(HumanField::Layer(LayerId::Pasture));
    let mut farm = working(field);
    let mut pasture = working(field);
    for cell in 0..field.mesh.len() {
        let a = farms.get(cell)?;
        let b = grazing.get(cell)?;
        if a + b > 0. {
            let converted = (requested.get(cell)? - field.people.free_area(cell)?).clamp(0., a + b);
            farm.set(cell, converted * a / (a + b))?;
            pasture.set(cell, converted * b / (a + b))?;
        }
    }
    context.run(
        &owner.lay,
        &Lay {
            kind: LayerId::BuiltUp,
            amount: requested.read_only(),
        },
    )?;
    for (from, amount) in [(LayerId::Farmland, farm), (LayerId::Pasture, pasture)] {
        context.run(
            &owner.convert,
            &operations::Convert {
                from,
                to: LayerId::BuiltUp,
                amount: amount.read_only(),
            },
        )?;
    }
    Ok(())
}

fn harden(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    q: &Questions,
    owner: &operations::Operations<Field>,
    area_scale: f64,
) -> ExecutionResult<()> {
    if !work.facts.builds {
        return Ok(());
    }
    let builders = context.query(&q.building)?.values();
    let wealth = context.query(&q.wealth)?.values();
    let field = context.state();
    let built = field.people.view(HumanField::Layer(LayerId::BuiltUp));
    let works = field.people.view(HumanField::Layer(LayerId::Standing));
    let farms = field.people.view(HumanField::Layer(LayerId::Farmland));
    let mut raised = working(field);
    let building = 1.0 - (-work.facts.years / BUILDING_YEARS).exp();
    for cell in 0..field.mesh.len() {
        if !habitable(field, cell)? {
            continue;
        }
        let labour = field.people.people(cell)? * builders.get(cell)? * wealth.get(cell)?.sqrt();
        let needed = land_needed(labour, farms.get(cell)?, area_scale);
        let standing = built.get(cell)?;
        if needed > standing {
            raised.set(cell, (needed - standing) * building)?;
        }
    }
    occupy_land(context, owner, &raised)?;
    let gathering = 1.0 - (-work.facts.years / WORKS_YEARS).exp();
    for cell in 0..context.state().mesh.len() {
        raised.set(
            cell,
            (standing_target(built.get(cell)?, wealth.get(cell)?) - works.get(cell)?).max(0.0)
                * gathering,
        )?;
    }
    context.run(
        &owner.lay,
        &Lay {
            kind: LayerId::Standing,
            amount: raised.read_only(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::land_needed;

    #[test]
    fn construction_can_use_more_land_with_the_same_workforce() {
        for (workers_per_km2, previous_share) in [(2_000., 0.20), (8_000., 0.50)] {
            let developed = land_needed(workers_per_km2, 0., 1.);
            assert!(developed > previous_share + 0.15);
            assert!(land_needed(workers_per_km2, 0.8, 1.) < developed);
            assert!(land_needed(workers_per_km2, 0., 2.) > developed);
        }
        assert_eq!(land_needed(0., 0., 1.), 0.);
    }
}
