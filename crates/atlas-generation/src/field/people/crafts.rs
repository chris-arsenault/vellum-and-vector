use super::{
    contract::{Dispatch, MapType, Rule, Timing},
    facts::PEOPLE_PER_BUILT_KM2,
    work::working,
};
use crate::{
    answers::{QuestionBook, Responder, ResponseKind},
    execution::{Command, CommandKind, ExecutionResult, QueryDependency},
    field::{shared::Scalar as S, Field},
    human::{
        identity::Tradition,
        operations::{self, Overlay},
        HumanField,
    },
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale, RelativeMeasure},
};
use std::{io, rc::Rc};
mod roots;
mod town;
pub(crate) use roots::RootReach;
pub(crate) use town::vow as permits_on_consecrated_ground;
pub use town::{PracticeReads, TownMaterial, TownPractice};

#[derive(Clone, Copy)]
pub struct Craft {
    pub system: &'static str,
    pub code: i32,
    pub name: &'static str,
    pub medium: S,
    pub town: TownPractice,
    /// The word a realm's name ends in when a third of its people keep this craft: the old
    /// society cycle's Hold, Conclave and Covenant, and one for each later craft.
    pub realm_term: &'static str,
}
// Arconis: docs/architecture/subsystems.arconis#item=pp_crafts — the seven magic crafts, each learned where its medium lies.
pub const CRAFTS: [Craft; 7] = [
    Craft {
        system: "fire",
        code: 1,
        name: "hearth-keeping",
        medium: S::Quickening,
        town: town::FIRE,
        realm_term: "Hold",
    },
    Craft {
        system: "aurora",
        code: 2,
        name: "reading",
        medium: S::Stillness,
        town: town::AURORA,
        realm_term: "Conclave",
    },
    Craft {
        system: "pressure",
        code: 3,
        name: "diving",
        medium: S::FogForcing,
        town: town::PRESSURE,
        realm_term: "Covenant",
    },
    Craft {
        system: "greenwood",
        code: 4,
        name: "tending",
        medium: S::Verdure,
        town: town::GREENWOOD,
        realm_term: "Circle",
    },
    Craft {
        system: "salt",
        code: 5,
        name: "raking",
        medium: S::Salting,
        town: town::SALT,
        realm_term: "Compact",
    },
    Craft {
        system: "hallowed",
        code: 6,
        name: "the vow",
        medium: S::Warding,
        town: town::HALLOWED,
        realm_term: "Oath",
    },
    Craft {
        system: "veil",
        code: 7,
        name: "door-keeping",
        medium: S::Tearing,
        town: town::VEIL,
        realm_term: "Threshold",
    },
];
pub fn by_code(code: i32) -> Option<Craft> {
    CRAFTS.iter().copied().find(|craft| craft.code == code)
}

pub(crate) fn working_material(
    field: &Field,
    craft: Craft,
    systems: &[crate::magic::state::MagicField],
    cell: usize,
) -> io::Result<bool> {
    let Some(material) = craft.town.material else {
        return Ok(true);
    };
    let Some(system) = systems
        .iter()
        .find(|system| system.definition().id == craft.system)
    else {
        return Ok(false);
    };
    let ground = field.ground();
    let sealed = system.channel(crate::magic::channels::Channel::Sealed);
    for source in
        std::iter::once(cell).chain((0..3).filter_map(|edge| field.mesh.neighbor(cell, edge)))
    {
        if sealed.get(source)? <= 0.
            && system.reservoir_amount(&ground, material.reservoir, source)? > 0.
        {
            return Ok(true);
        }
    }
    Ok(false)
}
pub fn medium_at(field: &Field, craft: Craft, cell: usize) -> io::Result<f64> {
    let value = field.shared.scalar(craft.medium).get(cell)?;
    Ok(if value > 0.0 { value.min(1.0) } else { 0.0 })
}
pub fn holding(field: &Field, craft: Craft, cell: usize) -> io::Result<f64> {
    let everyone = field.people.people(cell)?;
    if everyone <= 0.0 {
        return Ok(0.0);
    }
    let held: f64 = field
        .people
        .column(cell)?
        .iter()
        .filter(|l| l.traditions[Tradition::Craft as usize] == craft.code)
        .map(|l| l.people)
        .sum();
    Ok((held / everyone).min(1.0))
}
pub fn practised(field: &Field, craft: Craft, cell: usize) -> io::Result<f64> {
    let medium = medium_at(field, craft, cell)?;
    Ok(if medium > 0.0 {
        medium * holding(field, craft, cell)?
    } else {
        0.0
    })
}
pub fn nearby(field: &Field, craft: Craft, cell: usize) -> io::Result<f64> {
    let mut held = practised(field, craft, cell)?;
    for edge in 0..3 {
        if let Some(next) = field.mesh.neighbor(cell, edge) {
            held = held.max(practised(field, craft, next)?);
        }
    }
    Ok(held)
}
pub fn sea_held_off(field: &Field, cell: usize) -> io::Result<f64> {
    let depth = field.water.borrow().effective_sea_level()
        - field.ground().view(GroundField::Elevation).get(cell)?;
    let holdable = field
        .scale
        .resolve(
            RelativeMeasure::new(0.0000125, 1, 0.5, LengthUnit::Metre).map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?
        .value();
    if depth <= 0.0 || depth > MapScale::in_units(holdable, LengthUnit::Native) {
        return Ok(0.0);
    }
    nearby(field, CRAFTS[2], cell)
}
pub(super) const LEARNING: Dispatch<()> = Dispatch {
    id: "human.crafts.learn",
    rules: &[
        Rule::new(MapType::WORLD, Some(())).during(Timing::Elapsed),
        Rule::new(MapType::WORLD, None).during(Timing::Present),
        Rule::new(MapType::REFINED, None),
    ],
};

pub fn learning(owner: Rc<operations::Operations<Field>>) -> Command<Field, f64> {
    Command::with_inputs(
        LEARNING.id,
        CommandKind::Elapsed,
        vec![],
        move |context, years: &f64| {
            let field = context.state();
            let mut code = field.coverage.borrow_mut().scratch(field.mesh.len(), 0i32);
            let mut people = working(field);
            let learning = -(-years / 300.0).exp_m1();
            for cell in 0..field.mesh.len() {
                let mut chosen = None;
                let mut medium = 0.0;
                for craft in CRAFTS {
                    let here = medium_at(field, craft, cell)?;
                    if here > medium {
                        chosen = Some(craft);
                        medium = here;
                    }
                }
                if let Some(craft) = chosen {
                    code.set(cell, craft.code)?;
                    let unlearned = (medium - holding(field, craft, cell)?).max(0.0);
                    people.set(cell, field.people.people(cell)? * unlearned * learning)?;
                }
            }
            let mut traditions = std::array::from_fn(|_| None);
            traditions[Tradition::Craft as usize] = Some(code.read_only());
            context.run(
                &owner.overlay,
                &Overlay {
                    traditions,
                    people: people.read_only(),
                    hardness: 0.0,
                },
            )
        },
    )
}
// Arconis: docs/architecture/subsystems.arconis#item=c_craft — registers each craft's rule break for the share who practise it.
pub fn breaks(
    book: &mut QuestionBook<Field, &'static str>,
    dependencies: Vec<QueryDependency<Field>>,
) -> ExecutionResult<()> {
    for (craft, key, value) in [
        (CRAFTS[0], "season", 1.0),
        (CRAFTS[0], "climbing", 0.0),
        (CRAFTS[1], "forgetting", 0.0),
        (CRAFTS[3], "moving", 0.0),
        (CRAFTS[3], "building", 0.0),
        (CRAFTS[3], "harm", 0.0),
        (CRAFTS[4], "yielding", 0.0),
        (CRAFTS[5], "harm", 0.0),
    ] {
        book.respond(
            key,
            Responder {
                by: craft.name.into(),
                queries: dependencies.clone(),
                kind: ResponseKind::Break {
                    share: Box::new(move |field, cell, _| Ok(practised(field, craft, cell)?)),
                    instead: Box::new(move |_, _, _| Ok(value)),
                },
            },
        )?;
    }
    book.respond(
        "presence",
        Responder {
            by: CRAFTS[4].name.into(),
            queries: dependencies.clone(),
            kind: ResponseKind::Break {
                share: Box::new(|field, cell, _| Ok(practised(field, CRAFTS[4], cell)?)),
                instead: Box::new(|field, cell, _| {
                    Ok(field.people.people(cell)?.max(
                        field.people.view(HumanField::RuinedBuiltUp).get(cell)?
                            * PEOPLE_PER_BUILT_KM2,
                    ))
                }),
            },
        },
    )?;
    book.respond(
        "seaStand",
        Responder {
            by: CRAFTS[2].name.into(),
            queries: dependencies.clone(),
            kind: ResponseKind::Break {
                share: Box::new(|field, cell, _| Ok(sea_held_off(field, cell)?)),
                instead: Box::new(|field, cell, _| {
                    Ok(2.0 * field.ground().view(GroundField::Elevation).get(cell)?
                        - field.water().effective_sea_level)
                }),
            },
        },
    )?;
    book.respond(
        "harm",
        Responder {
            by: "the vow's rim".into(),
            queries: dependencies,
            kind: ResponseKind::Scale(Box::new(|field, cell, _| {
                let mut turned = 0.0f64;
                for edge in 0..3 {
                    if let Some(next) = field.mesh.neighbor(cell, edge) {
                        turned = turned.max(practised(field, CRAFTS[5], next)?);
                    }
                }
                Ok(1.0 + turned)
            })),
        },
    )
}
pub fn kept_doors(
    field: &Field,
    doors: &[crate::magic::state::Door],
) -> io::Result<Vec<crate::links::Link>> {
    kept_doors_with(field, doors, |_| None)
}

/// Local holdings stand in for their own keepers once a town has placed them.
/// Unrepresented entrances still read the surrounding world's practitioners.
pub(crate) fn kept_doors_with(
    field: &Field,
    doors: &[crate::magic::state::Door],
    keeper: impl Fn(usize) -> Option<f64>,
) -> io::Result<Vec<crate::links::Link>> {
    let keeping_at = |cell| -> io::Result<f64> {
        let natural = nearby(field, CRAFTS[6], cell)?;
        Ok(keeper(cell).map_or(natural, |holding| natural.min(holding)))
    };
    let mut links = Vec::new();
    for door in doors {
        let keeping = keeping_at(door.a)?.min(keeping_at(door.b)?);
        if keeping > 0.0 {
            links.push(crate::links::Link {
                a: door.a,
                b: door.b,
                cost: field.mesh.spacing() / keeping,
            });
        }
    }
    Ok(links)
}

/// Keepers are read on each search; door pairing is captured from the current magic operation.
pub fn offer_doors(
    offers: &mut crate::links::Offers<Field>,
    doors: Vec<crate::magic::state::Door>,
) {
    offers.offer(CRAFTS[6].name, move |field| kept_doors(field, &doors));
}
