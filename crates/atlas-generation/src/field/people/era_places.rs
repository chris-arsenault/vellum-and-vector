use super::{
    classifier::{dense_zones, ruin_sites},
    facts::PEOPLE_PER_BUILT_KM2,
    identity_reads::leading_of,
    place_country::{self, KnownWay},
    places::Places,
    questions::Questions,
    travel::Travel,
};
use crate::{
    execution::{Command, CommandKind, Query},
    field::Field,
    human::{identity::Tradition, operations},
    links::Offers,
    storage::ReadBand,
};
use std::{cell::RefCell, rc::Rc};

pub struct Setting {
    pub places: Rc<RefCell<Places>>,
    pub ways: Rc<RefCell<Vec<KnownWay>>>,
    pub links: Rc<Offers<Field>>,
    pub era: String,
    pub least: f64,
    pub town: Option<f64>,
    pub country: place_country::Setting,
}
pub fn operation(
    questions: Rc<Questions>,
    rivers: Query<Field, ReadBand<u32>>,
    owner: Rc<operations::Operations<Field>>,
) -> Command<Field, Setting> {
    Command::with_inputs(
        "human.places.record",
        CommandKind::Work,
        vec![],
        move |context, setting: &Setting| {
            let support = context.query(&questions.support)?.values();
            let presence = context.query(&questions.presence)?.values();
            let field = context.state();
            let mut places = setting.places.borrow_mut();
            places.record(
                &dense_zones(field, &support, setting.least / 2.0, Some(&presence))?,
                &setting.era,
                setting.least,
                setting.town.unwrap_or(setting.least),
                field.mesh.len(),
            );
            places.record_remains(
                &ruin_sites(field, setting.least / PEOPLE_PER_BUILT_KM2)?,
                &setting.era,
                field.mesh.len(),
            );
            let tongues = leading_of(field, Tradition::Tongue)?;
            for place in &mut places.known {
                if place.tongue.unwrap_or(0) == 0
                    && place.abandoned.is_none()
                    && tongues.code[place.anchor] != 0
                {
                    place.tongue = Some(tongues.code[place.anchor]);
                }
            }
            let friction = context.query(&questions.friction)?.values();
            let climbing = context.query(&questions.climbing)?.values();
            let rivers = context.query(&rivers)?;
            let field = context.state();
            let travel = Travel::new(field, friction, climbing, rivers)?;
            let (ways, worn) = place_country::record(
                field,
                &mut places,
                &setting.country,
                &|a, b| travel.step(a, b),
                &setting.links,
            )?;
            *setting.ways.borrow_mut() = ways;
            context.run(&owner.travel, &worn.read_only())
        },
    )
}
