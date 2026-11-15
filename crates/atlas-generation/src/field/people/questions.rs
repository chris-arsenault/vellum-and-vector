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
    pub harm: Query<Field, AnswerBand>,
    pub moving: Query<Field, AnswerBand>,
    pub building: Query<Field, AnswerBand>,
    pub forgetting: Query<Field, AnswerBand>,
    pub friction: Query<Field, AnswerBand>,
    pub climbing: Query<Field, AnswerBand>,
    pub yielding: Query<Field, AnswerBand>,
    pub presence: Query<Field, AnswerBand>,
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
            harm: query("harm"),
            moving: query("moving"),
            building: query("building"),
            forgetting: query("forgetting"),
            friction: query("travelFriction"),
            climbing: query("climbing"),
            yielding: query("yielding"),
            presence: query("presence"),
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
            &self.harm,
            &self.moving,
            &self.building,
            &self.forgetting,
            &self.friction,
            &self.climbing,
            &self.yielding,
            &self.presence,
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
        "presence",
        Responder {
            by: "the living".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|field, cell, _| Ok(field.people.people(cell)?))),
        },
    )
}
