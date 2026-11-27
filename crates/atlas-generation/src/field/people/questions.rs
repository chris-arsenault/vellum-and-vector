use crate::{
    answers::{AnswerBand, QuestionBook, Responder, ResponseKind},
    execution::{ExecutionResult, Query, QueryDependency},
    field::Field,
};
use std::rc::Rc;

pub struct Questions {
    pub season: Query<Field, AnswerBand>,
    pub support: Query<Field, AnswerBand>,
    pub wild: Query<Field, AnswerBand>,
    pub crop: Query<Field, AnswerBand>,
    pub herd: Query<Field, AnswerBand>,
    /// What rivers and shores give those who fish them, per km² of wild ground.
    pub catch: Query<Field, AnswerBand>,
    pub harm: Query<Field, AnswerBand>,
    pub moving: Query<Field, AnswerBand>,
    pub building: Query<Field, AnswerBand>,
    pub forgetting: Query<Field, AnswerBand>,
    pub friction: Query<Field, AnswerBand>,
    pub climbing: Query<Field, AnswerBand>,
    pub yielding: Query<Field, AnswerBand>,
    pub presence: Query<Field, AnswerBand>,
    pub draw: Query<Field, AnswerBand>,
    pub livable: Query<Field, AnswerBand>,
    pub cleared: Query<Field, AnswerBand>,
    pub grazed: Query<Field, AnswerBand>,
    pub hunted: Query<Field, AnswerBand>,
    pub fished: Query<Field, AnswerBand>,
    /// How many times the works its built ground alone would gather a cell gathers toward.
    pub wealth: Query<Field, AnswerBand>,
    /// How many people a square kilometre of built ground houses at ease.
    pub room: Query<Field, AnswerBand>,
}
pub fn built_hold(
    book: &mut QuestionBook<Field, &'static str>,
    dependencies: Vec<QueryDependency<Field>>,
) -> ExecutionResult<()> {
    book.respond(
        "rootHold",
        Responder {
            by: "built places".into(),
            queries: dependencies,
            kind: ResponseKind::Add(Box::new(|field, cell, _| {
                let built = field
                    .people
                    .view(crate::human::HumanField::Layer(
                        crate::human::catalogue::LayerId::BuiltUp,
                    ))
                    .get(cell)?;
                Ok(if built > 0.0 {
                    built * (1.0 + field.people.standing(cell)?)
                } else {
                    0.0
                })
            })),
        },
    )
}
impl Questions {
    pub fn new(book: Rc<QuestionBook<Field, &'static str>>) -> Self {
        Self::from_query(|key| Field::question(book.clone(), key, key))
    }
    pub fn bound(book: &crate::answers::QuestionBinding<Field, &'static str>) -> Self {
        Self::from_query(|key| Field::bound_question(book, key, key))
    }
    fn from_query(query: impl Fn(&'static str) -> Query<Field, AnswerBand>) -> Self {
        Self {
            season: query("season"),
            support: query("support"),
            wild: query("wildYield"),
            crop: query("cropYield"),
            herd: query("herdYield"),
            catch: query("catchYield"),
            harm: query("harm"),
            moving: query("moving"),
            building: query("building"),
            forgetting: query("forgetting"),
            friction: query("travelFriction"),
            climbing: query("climbing"),
            yielding: query("yielding"),
            presence: query("presence"),
            draw: query("draw"),
            livable: query("livable"),
            cleared: query("cleared"),
            grazed: query("grazed"),
            hunted: query("hunted"),
            fished: query("fished"),
            wealth: query("wealth"),
            room: query("room"),
        }
    }
    pub fn select(&self, executor: &mut crate::execution::Executor<Field>) {
        self.select_in(&mut executor.selection());
    }
    pub fn select_in(&self, executor: &mut crate::execution::Selection<'_, Field>) {
        for question in [
            &self.season,
            &self.support,
            &self.wild,
            &self.crop,
            &self.herd,
            &self.catch,
            &self.harm,
            &self.moving,
            &self.building,
            &self.forgetting,
            &self.friction,
            &self.climbing,
            &self.yielding,
            &self.presence,
            &self.draw,
            &self.livable,
            &self.cleared,
            &self.grazed,
            &self.hunted,
            &self.fished,
            &self.wealth,
            &self.room,
        ] {
            executor.select(question);
        }
    }
}
// Arconis: docs/architecture/subsystems.arconis#item=r_harm — registers base answers, including harm from what strikes.
pub fn rules(book: &mut QuestionBook<Field, &'static str>) -> ExecutionResult<()> {
    for (key, by) in [
        ("harm", "what strikes"),
        ("moving", "people free to go"),
        ("building", "people who stay"),
        ("forgetting", "time"),
        ("yielding", "people who can change their minds"),
        ("wealth", "built ground"),
    ] {
        book.respond(
            key,
            Responder {
                by: by.into(),
                queries: vec![],
                kind: ResponseKind::Base(Box::new(|_, _, _| Ok(1.0))),
            },
        )?;
    }
    book.respond(
        "room",
        Responder {
            by: "households at ease".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|_, _, _| Ok(super::facts::PEOPLE_PER_BUILT_KM2))),
        },
    )?;
    book.respond(
        "presence",
        Responder {
            by: "the living".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|field, cell, _| Ok(field.people.people(cell)?))),
        },
    )?;
    book.respond(
        "livable",
        Responder {
            // Ice already starves the people on it through the harvest it stops, so only water
            // refuses them here; magic media refuse them through their own responders.
            by: "dry ground".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|field, cell, _| {
                Ok(f64::from(u8::from(
                    field.water.borrow().kind_at(cell)? == 0,
                )))
            })),
        },
    )
}
