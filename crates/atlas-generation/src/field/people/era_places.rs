use super::{
    classifier::{dense_zones, ruin_sites},
    facts::PEOPLE_PER_BUILT_KM2,
    identity_reads::leading_of,
    place_country::{self, KnownWay},
    places::Places,
    questions::Questions,
    reach::Passage,
    travel::Travel,
    work::{habitable, km2, working},
};
use crate::{
    execution::{Command, CommandKind, Query},
    field::Field,
    human::{identity::Tradition, operations},
    links::Offers,
    storage::{Band, ReadBand},
};
use std::{cell::RefCell, io, rc::Rc};

pub struct Setting {
    pub places: Rc<RefCell<Places>>,
    pub ways: Rc<RefCell<Vec<KnownWay>>>,
    pub links: Rc<Offers<Field>>,
    pub era: String,
    pub least: f64,
    pub town: Option<f64>,
    pub country: place_country::Setting,
}
/// Records on each living place the goods its people trade a year, read from the land as the
/// era leaves it, over a settled pass's going.
fn record_goods(field: &Field, travel: &Travel<'_>, places: &mut Places) -> io::Result<()> {
    let facts = super::facts::Facts::settled(1.0, 1.0);
    let range = super::travel::length(field, facts.range)?;
    let going = Passage::new(
        &field.mesh,
        &mut field.coverage.borrow_mut(),
        |a, b| travel.step(a, b),
        range,
    )?
    .with_links(
        &field.mesh,
        field.place_offers().map_or(&[], |o| o.links()),
        range,
    )?;
    let work = super::work::Work::over(field, facts, going)?;
    let trade = super::goods::trade(field, &work)?;
    for place in places.known.iter_mut() {
        place.goods = if place.abandoned.is_none() && place.absorbed_by.is_none() {
            super::goods::traded_by(field, &trade, &place.cells)?
        } else {
            0.0
        };
    }
    Ok(())
}
/// People per km² averaged over the habitable country a traveller reaches from each cell.
pub fn surrounding_density(
    field: &Field,
    travel: &Travel<'_>,
    range: f64,
    people: &ReadBand<f64>,
) -> io::Result<Band<f64>> {
    let going = Passage::new(
        &field.mesh,
        &mut field.coverage.borrow_mut(),
        |a, b| travel.step(a, b),
        range,
    )?;
    let mut area = working(field);
    let mut mass = working(field);
    for cell in 0..field.mesh.len() {
        if habitable(field, cell)? {
            area.set(cell, km2(field, cell))?;
            mass.set(cell, people.get(cell)? * km2(field, cell))?;
        }
    }
    let mut reached_area = working(field);
    let mut reached_mass = working(field);
    let mut density = working(field);
    {
        let mut coverage = field.coverage.borrow_mut();
        going.reach(
            &field.mesh,
            &mut coverage,
            &area.read_only(),
            &mut reached_area,
            super::reach::REACH_SWEEPS,
        )?;
        going.reach(
            &field.mesh,
            &mut coverage,
            &mass.read_only(),
            &mut reached_mass,
            super::reach::REACH_SWEEPS,
        )?;
    }
    for cell in 0..field.mesh.len() {
        let land = reached_area.get(cell)?;
        if land > 0.0 {
            density.set(cell, reached_mass.get(cell)? / land)?;
        }
    }
    Ok(density)
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
            let presence = context.query(&questions.presence)?.values();
            let friction = context.query(&questions.friction)?.values();
            let climbing = context.query(&questions.climbing)?.values();
            let rivers = context.query(&rivers)?;
            let field = context.state();
            let travel = Travel::new(field, friction, climbing, rivers)?;
            let country = surrounding_density(field, &travel, setting.country.range, &presence)?;
            let mut places = setting.places.borrow_mut();
            places.record(
                &dense_zones(
                    field,
                    &country.read_only(),
                    setting.least / 2.0,
                    Some(&presence),
                )?,
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
            record_goods(field, &travel, &mut places)?;
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
