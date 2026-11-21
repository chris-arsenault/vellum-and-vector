// Arconis: docs/architecture/subsystems.arconis#item=pp_ident — spreads tongue, faith and custom between places.
use super::{
    identity_era,
    places::Places,
    questions::Questions,
    reach::Passage,
    realm_era, traditions,
    travel::{length, Travel},
};
use crate::{
    execution::{Command, CommandKind, Query},
    field::Field,
    human::operations,
    links::Offers,
    spatial::SpatialKernel,
    storage::ReadBand,
};
use std::{cell::RefCell, rc::Rc};

pub struct Era {
    pub memory: Rc<RefCell<traditions::Context>>,
    pub places: Rc<RefCell<Places>>,
    pub links: Rc<Offers<Field>>,
    pub era: String,
    pub years: f64,
    pub mobility: f64,
    pub political_capacity: f64,
    pub city_reach: f64,
    pub cultural_mobility: f64,
    pub culture_count: usize,
    pub political_reach: f64,
    pub polity_count: usize,
}
pub struct Operations {
    pub identity: Command<Field, Era>,
    pub realms: Command<Field, Era>,
}
impl Operations {
    pub fn new(
        questions: Rc<Questions>,
        owner: Rc<operations::Operations<Field>>,
        rivers: Query<Field, ReadBand<u32>>,
        spatial: Rc<dyn SpatialKernel>,
    ) -> Self {
        let identity = identity_era::operation(questions.clone(), owner.clone(), spatial);
        let realms = realm_era::operation(questions.clone(), owner);
        let identity_q = questions.clone();
        let identity_rivers = rivers.clone();
        Self {
            identity: Command::with_inputs(
                "human.identity-era",
                CommandKind::Elapsed,
                vec![],
                move |context, era: &Era| {
                    let friction = context.query(&identity_q.friction)?.values();
                    let climbing = context.query(&identity_q.climbing)?.values();
                    let rivers = context.query(&identity_rivers)?;
                    let field = context.state();
                    let travel =
                        Travel::new(field, friction.clone(), climbing.clone(), rivers.clone())?;
                    let range = length(field, era.city_reach)?;
                    let going = Rc::new(
                        Passage::new(
                            &field.mesh,
                            &mut field.coverage.borrow_mut(),
                            |a, b| travel.step(a, b),
                            range,
                        )?
                        .with_links(field.place_offers().map_or(&[], |o| o.links()), range)?,
                    );
                    context.run(
                        &identity,
                        &identity_era::Era {
                            memory: era.memory.clone(),
                            era: era.era.clone(),
                            years: era.years,
                            mobility: era.mobility * era.cultural_mobility,
                            founders: era.culture_count,
                            going,
                            friction,
                            climbing,
                            rivers,
                            links: era.links.clone(),
                        },
                    )
                },
            ),
            realms: Command::with_inputs(
                "human.realm-era",
                CommandKind::Elapsed,
                vec![],
                move |context, era: &Era| {
                    let friction = context.query(&questions.friction)?.values();
                    let climbing = context.query(&questions.climbing)?.values();
                    let rivers = context.query(&rivers)?;
                    let reach = length(context.state(), 0.0625)? * era.political_reach;
                    context.run(
                        &realms,
                        &realm_era::Era {
                            memory: era.memory.clone(),
                            places: era.places.clone(),
                            era: era.era.clone(),
                            years: era.years,
                            reach,
                            capacity: era.political_capacity,
                            realms: era.polity_count,
                            friction,
                            climbing,
                            rivers,
                            links: era.links.clone(),
                        },
                    )
                },
            ),
        }
    }
}
