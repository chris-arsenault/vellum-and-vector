use super::super::{shared::Scalar, Field};
use crate::{
    answers::{QuestionBook, Responder, ResponseKind},
    execution::{ExecutionResult, Query, QueryDependency},
    human::HumanField,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::ReadBand,
};
use std::{io, rc::Rc};

pub fn river_orders(dependencies: Vec<QueryDependency<Field>>) -> Query<Field, ReadBand<u32>> {
    Query::new(
        "human.current-river-orders",
        dependencies,
        |field: &Field, _| {
            let water = field.water.borrow();
            let reader = water.river_reader();
            let kind = water.read_only().column.kind;
            let mut result = field.coverage.borrow_mut().allocate(0u32);
            for cell in 0..field.mesh.len() {
                result.set(cell, u32::from(reader.order_at(cell, kind.get(cell)?)))?;
            }
            Ok(result.read_only())
        },
    )
}
pub fn length(field: &Field, fraction: f64) -> io::Result<f64> {
    Ok(field
        .scale
        .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
/// How much easier people's country is to cross where all of them understand the tongue
/// spoken around them.
const SHARED_SPEECH: f64 = 0.3;
/// The share of a cell's people who speak or know the tongue most spoken on and around it:
/// all of them deep in one tongue's country, few at a frontier where no one has learned the
/// neighbours' speech. Empty ground has no one to understand and is neither.
fn understood(field: &Field, cell: usize) -> io::Result<f64> {
    Ok(super::speech::understood(&super::speech::around(
        field, cell,
    )?))
}
pub fn respond(
    book: &mut QuestionBook<Field, &'static str>,
    rivers: Query<Field, ReadBand<u32>>,
    dependencies: Vec<QueryDependency<Field>>,
) -> ExecutionResult<()> {
    let mut reads = dependencies;
    reads.push(rivers.dependency());
    book.respond(
        "travelFriction",
        Responder {
            by: "ground, cover and water".into(),
            queries: reads,
            kind: ResponseKind::Base(Box::new(move |field, cell, answers| {
                let ice = (field.shared.scalar(Scalar::IceThickness).get(cell)?
                    / length(field, 0.00025)?)
                .min(1.0);
                let afloat = field.water().column.kind.get(cell)? != 0
                    || answers.queries().get(&rivers)?.get(cell)? > 0;
                let going = if afloat {
                    0.5
                } else {
                    1.0 + field.shared.scalar(Scalar::TreeCover).get(cell)?
                        + 2.0 * field.shared.scalar(Scalar::WetlandCover).get(cell)?
                };
                Ok(going + 3.0 * ice)
            })),
        },
    )?;
    book.respond(
        "travelFriction",
        Responder {
            by: "the places on the way".into(),
            queries: vec![],
            kind: ResponseKind::Scale(Box::new(|field, cell, _| {
                Ok(match field.place_offers() {
                    Some(offers) if field.water().column.kind.get(cell)? == 0 => {
                        offers.road(cell)?
                    }
                    _ => 1.0,
                })
            })),
        },
    )?;
    book.respond(
        "travelFriction",
        Responder {
            by: "a tongue in common".into(),
            queries: vec![],
            kind: ResponseKind::Scale(Box::new(|field, cell, _| {
                Ok(1.0 - SHARED_SPEECH * understood(field, cell)?)
            })),
        },
    )?;
    book.respond(
        "travelFriction",
        Responder {
            by: "worn ways".into(),
            queries: vec![],
            kind: ResponseKind::Scale(Box::new(|field, cell, _| {
                Ok(if field.water().column.kind.get(cell)? == 0 {
                    1.0 - 0.5
                        * (1.0
                            - (-field.people.view(HumanField::WalkedRoute).get(cell)? / WORN).exp())
                } else {
                    1.0
                })
            })),
        },
    )?;
    book.respond(
        "climbing",
        Responder {
            by: "the ground's height".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|_, _, _| Ok(1.0))),
        },
    )?;
    book.respond(
        "climbing",
        Responder {
            by: "graded roads".into(),
            queries: vec![],
            kind: ResponseKind::Scale(Box::new(|field, cell, _| {
                let traffic = field.people.view(HumanField::WalkedRoute).get(cell)?;
                Ok(if graded(traffic) { 1.0 - GRADING } else { 1.0 })
            })),
        },
    )
}
/// The traffic, in traveller-years, over which a way wears its ground most of the way it
/// will, and at which people grade its climbs.
pub const WORN: f64 = 50_000.0;
/// How much of a climb's cost and steepness a graded road takes away.
const GRADING: f64 = 0.5;
/// Whether a way carrying `traffic` is graded where it climbs: cut and terraced over its cols
/// and slopes, so it climbs at half the cost and twice the steepness.
pub fn graded(traffic: f64) -> bool {
    traffic >= WORN
}
pub struct Travel<'a> {
    field: &'a Field,
    friction: ReadBand<f64>,
    climbing: ReadBand<f64>,
    rivers: Rc<ReadBand<u32>>,
    launch: f64,
}
impl<'a> Travel<'a> {
    pub fn new(
        field: &'a Field,
        friction: ReadBand<f64>,
        climbing: ReadBand<f64>,
        rivers: Rc<ReadBand<u32>>,
    ) -> io::Result<Self> {
        Ok(Self {
            field,
            friction,
            climbing,
            rivers,
            launch: length(field, 0.0025)?,
        })
    }
    pub fn step(&self, from: usize, to: usize) -> io::Result<f64> {
        let mesh = &self.field.mesh;
        let a = mesh.position(from);
        let b = mesh.position(to);
        let distance = mesh.delta_x(a[0] - b[0]).hypot(a[1] - b[1]);
        let going = distance * (self.friction.get(from)? + self.friction.get(to)?) / 2.0;
        let water = self.field.water().column.kind;
        let afloat = water.get(from)? != 0;
        let landing = water.get(to)? != 0;
        if afloat || landing {
            return Ok(going + if afloat == landing { 0.0 } else { self.launch });
        }
        let elevation = self.field.ground().view(GroundField::Elevation);
        let rise = MapScale::metres(
            elevation.get(to)? - elevation.get(from)?,
            LengthUnit::Native,
        )
        .abs();
        let held = (self.climbing.get(from)? + self.climbing.get(to)?) / 2.0;
        if (self.rivers.get(from)? > 0 && self.rivers.get(to)? > 0) || held <= 0.0 {
            return Ok(going);
        }
        Ok(if rise / distance > 0.6 / held {
            f64::INFINITY
        } else {
            going + 30.0 * rise * held
        })
    }
}
#[cfg(test)]
mod tests {
    use super::{graded, Travel, GRADING, WORN};
    use crate::{
        field::people::fixture::*,
        rock::ground::GroundField,
        scale::{LengthUnit, MapScale},
    };
    use std::rc::Rc;

    #[test]
    fn a_graded_way_climbs_a_col_too_steep_for_a_track() {
        assert!(graded(WORN) && !graded(WORN / 2.0));
        let (mut foot, mut col) = (0, 0);
        let field = land(|seed, mesh| {
            foot = point(mesh, 500.0, 500.0);
            col = (0..3).find_map(|e| mesh.neighbor(foot, e)).unwrap();
            let [ax, ay] = mesh.position(foot);
            let [bx, by] = mesh.position(col);
            // A climb of nine tenths of the step's length.
            let rise = 0.9 * mesh.delta_x(ax - bx).hypot(ay - by);
            let native = rise / MapScale::metres(1.0, LengthUnit::Native);
            // The ground projects its surface from its bedrock when the field is made.
            seed.ground
                .storage
                .initialize(GroundField::BedrockElevation, col, native)
                .unwrap();
        });
        let rivers = || {
            let band = field.coverage.borrow_mut().allocate(0u32);
            Rc::new(band.read_only())
        };
        let track = Travel::new(
            &field,
            band(&field, |_| 1.0),
            band(&field, |_| 1.0),
            rivers(),
        )
        .unwrap();
        let road = Travel::new(
            &field,
            band(&field, |_| 1.0),
            band(&field, |_| 1.0 - GRADING),
            rivers(),
        )
        .unwrap();
        let height = field
            .ground()
            .view(GroundField::Elevation)
            .get(col)
            .unwrap();
        assert!(height > 0.0, "the col stands {height} above its foot");
        assert_eq!(track.step(foot, col).unwrap(), f64::INFINITY);
        let graded_step = road.step(foot, col).unwrap();
        assert!(graded_step.is_finite());
        // On level ground the grading changes nothing.
        let flat = (0..3)
            .filter_map(|e| field.mesh.neighbor(foot, e))
            .find(|&c| c != col)
            .unwrap();
        assert_eq!(
            track.step(foot, flat).unwrap(),
            road.step(foot, flat).unwrap()
        );
    }
}
