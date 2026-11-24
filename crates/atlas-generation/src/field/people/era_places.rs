use super::{
    classifier::{dense_zones, ruin_sites},
    contract::{
        Absent, Condition, Dispatch, EffectTime, MapType, Rule, ScaleBand, Site, Source, Strategy,
        Timing,
    },
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

#[derive(Clone, Copy)]
enum PlaceSource {
    StandingHistory,
    AdoptCapturedIdentities,
}
impl Source for PlaceSource {
    type Value = Rc<RefCell<Places>>;
}

#[derive(Clone, Copy)]
enum RouteSource {
    ScopedTravelLinks,
}
impl Source for RouteSource {
    type Value = Rc<Offers<Field>>;
}

type Recording = Strategy<(), PlaceSource, RouteSource>;

const LINKS: Condition<RouteSource> = Condition::From {
    source: RouteSource::ScopedTravelLinks,
    absent: Absent::Error("Settlement recording requires the map's travel links"),
};

const HISTORY: Recording = Strategy {
    name: "Record settlements and wear routes over an era",
    time: EffectTime::Elapsed,
    slot: "era settlement recording after the people pass",
    initial: Condition::From {
        source: PlaceSource::StandingHistory,
        absent: Absent::Error("Settlement recording requires the era's place records"),
    },
    boundary: LINKS,
    algorithm: (),
};
const PRESENT: Recording = Strategy {
    name: "Adopt captured places and read current settlements and routes",
    time: EffectTime::Present,
    slot: "refinement settlement recording after the final terrain and people rounds",
    initial: Condition::From {
        source: PlaceSource::AdoptCapturedIdentities,
        absent: Absent::Error("Settlement recording requires the child map's place records"),
    },
    boundary: LINKS,
    algorithm: (),
};

const RECORD: Dispatch<Recording> = Dispatch {
    id: "human.places.record",
    rules: &[
        Rule::at(MapType::WORLD, ScaleBand::World, Some(HISTORY)).during(Timing::Elapsed),
        Rule::at(MapType::WORLD, ScaleBand::World, None).during(Timing::Present),
        Rule::at(MapType::REGIONAL, ScaleBand::Regional, Some(PRESENT)).during(Timing::Present),
        Rule::at(MapType::STREET, ScaleBand::Street, Some(PRESENT)).during(Timing::Present),
        Rule::at(MapType::REGIONAL, ScaleBand::Regional, None).during(Timing::Elapsed),
        Rule::at(MapType::STREET, ScaleBand::Street, None).during(Timing::Elapsed),
    ],
};

pub(crate) fn adopt_initial_places(
    site: Site,
    adopt: impl FnOnce() -> io::Result<()>,
) -> io::Result<()> {
    if let Some(PlaceSource::AdoptCapturedIdentities) = RECORD
        .select(site, Timing::Present)?
        .and_then(|recording| recording.initial.source())
    {
        adopt()?;
    }
    Ok(())
}

fn route_years(strategy: Recording, era_years: f64) -> f64 {
    if strategy.time == EffectTime::Elapsed {
        era_years
    } else {
        0.0
    }
}

pub struct Setting {
    pub places: Rc<RefCell<Places>>,
    pub ways: Rc<RefCell<Vec<KnownWay>>>,
    pub links: Rc<Offers<Field>>,
    pub era: String,
    pub least: f64,
    pub town: Option<f64>,
    pub timing: Timing,
    pub country: place_country::Setting,
}
/// Measures each living place's annual trade on the land as it stands when places are
/// recorded. A fresh reading accounts for changes since the last goods pass.
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
        RECORD.id,
        CommandKind::Work,
        vec![],
        move |context, setting: &Setting| {
            let Some(recording) = RECORD.select(context.state().process_site(), setting.timing)?
            else {
                return Ok(());
            };
            let places = recording
                .initial
                .bind(|source| match source {
                    PlaceSource::StandingHistory | PlaceSource::AdoptCapturedIdentities => {
                        Ok(Some(setting.places.clone()))
                    }
                })?
                .ok_or_else(|| {
                    io::Error::other("Settlement recording has no initial records condition")
                })?;
            let links = recording
                .boundary
                .bind(|source| match source {
                    RouteSource::ScopedTravelLinks => Ok(Some(setting.links.clone())),
                })?
                .ok_or_else(|| {
                    io::Error::other("Settlement recording has no travel links condition")
                })?;
            let route_settings = place_country::Setting {
                years: route_years(recording, setting.country.years),
                ..setting.country
            };
            let presence = context.query(&questions.presence)?.values();
            let friction = context.query(&questions.friction)?.values();
            let climbing = context.query(&questions.climbing)?.values();
            let rivers = context.query(&rivers)?;
            let field = context.state();
            let travel = Travel::new(field, friction, climbing, rivers)?;
            let country = surrounding_density(field, &travel, setting.country.range, &presence)?;
            let mut places = places.borrow_mut();
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
                &route_settings,
                &|a, b| travel.step(a, b),
                &links,
            )?;
            *setting.ways.borrow_mut() = ways;
            context.run(&owner.travel, &worn.read_only())
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn present_records_adopt_captured_identity_without_route_years() {
        for &kind in MapType::REFINED {
            let site = Site {
                map_type: kind,
                cell_metres: 50.0,
            };
            let mut retained = None;
            adopt_initial_places(site, || {
                retained = Some(("Nishi Mabasahiro", 450_202));
                Ok(())
            })
            .unwrap();
            assert_eq!(retained, Some(("Nishi Mabasahiro", 450_202)));
            let strategy = RECORD.select(site, Timing::Present).unwrap().unwrap();
            let records = Rc::new(RefCell::new(Places::default()));
            let bound = strategy
                .initial
                .bind(|source| {
                    assert!(matches!(source, PlaceSource::AdoptCapturedIdentities));
                    Ok(Some(records.clone()))
                })
                .unwrap()
                .unwrap();
            assert!(Rc::ptr_eq(&bound, &records));
            let scoped_links = Rc::new(Offers::<Field>::default());
            let links = strategy
                .boundary
                .bind(|RouteSource::ScopedTravelLinks| Ok(Some(scoped_links.clone())))
                .unwrap()
                .unwrap();
            assert!(Rc::ptr_eq(&links, &scoped_links));
            assert!(strategy.boundary.bind(|_| Ok(None)).is_err());
            assert_eq!(route_years(strategy, 250.0), 0.0);
            assert!(RECORD.select(site, Timing::Elapsed).unwrap().is_none());
        }
        let world = Site {
            map_type: MapType::World,
            cell_metres: ScaleBand::World.endpoints().0,
        };
        let era = RECORD.select(world, Timing::Elapsed).unwrap().unwrap();
        assert_eq!(route_years(era, 250.0), 250.0);
    }
}
