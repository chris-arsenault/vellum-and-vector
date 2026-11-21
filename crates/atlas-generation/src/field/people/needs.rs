//! People's needs: what each benefit a place offers is worth to the people of a cell, and the
//! `draw` question that gathering asks. Places say what they offer and to whom
//! (`field::poi::offered`); this table says what those offers are worth, and when. Neither
//! side knows the other: a new kind of place declares offers, a new need is a row here.
use super::facts::PEOPLE_PER_BUILT_KM2;
use crate::{
    answers::{Answers, QuestionBook, Responder, ResponseKind},
    execution::ExecutionResult,
    field::{poi::values::Benefit, Field},
    human::{catalogue::FULL_STANDING_PER_BUILT_KM2, HumanField},
};
use std::io;

/// When a need is felt.
#[derive(Clone, Copy)]
pub enum Felt {
    /// By everyone a benefit serves.
    Always,
    /// By people under threat, more the greater it is; a little in quiet country.
    UnderThreat,
    /// Only by the share of people the land as used does not feed, so food and water a place
    /// offers are not counted twice beside the land's own support. Market food is the town's
    /// own trade, so a town fed by imports still values food grown close by.
    WhereUnfed,
}
pub struct Need {
    pub benefit: Benefit,
    /// How much a full offer of the benefit multiplies a cell's pull, less one.
    pub worth: f64,
    pub felt: Felt,
}
/// The needs table. Starting values follow the old society cycle's site draw, which
/// multiplied a town's pull: a realm's seat ×2.5, a harbour ×1.6, a Fire seat ×1.4, a pass
/// ×1.3 and a river node ×1.2. Materials and power draw people through the goods their makers
/// trade (`goods.rs`), not as needs of their own.
pub const NEEDS: [Need; 7] = [
    Need {
        benefit: Benefit::Rule,
        worth: 1.5,
        felt: Felt::Always,
    },
    Need {
        benefit: Benefit::Trade,
        worth: 0.6,
        felt: Felt::Always,
    },
    Need {
        benefit: Benefit::Defence,
        worth: 0.3,
        felt: Felt::UnderThreat,
    },
    Need {
        benefit: Benefit::Sanctity,
        worth: 0.3,
        felt: Felt::Always,
    },
    Need {
        benefit: Benefit::Food,
        worth: 0.5,
        felt: Felt::WhereUnfed,
    },
    Need {
        benefit: Benefit::Water,
        worth: 0.5,
        felt: Felt::WhereUnfed,
    },
    // Scholars and pilgrims come to a temple or academy, as to a shrine.
    Need {
        benefit: Benefit::Learning,
        worth: 0.3,
        felt: Felt::Always,
    },
];
/// How much defence is wanted where nothing threatens: walls still draw a little.
const QUIET_DEFENCE: f64 = 0.25;
/// The share of the crowd a ruin's remains once housed that still draws people back.
pub const REMAINS_DRAW: f64 = 0.25;

/// How strongly a need is felt in a cell with `threatened` place threats, where `unfed` of the
/// people go hungry. Threat saturates: past a few overlapping dangers people are simply afraid.
pub fn felt(felt: Felt, threatened: f64, unfed: f64) -> f64 {
    match felt {
        Felt::Always => 1.0,
        Felt::UnderThreat => QUIET_DEFENCE + (1.0 - (-threatened.max(0.0)).exp()),
        Felt::WhereUnfed => unfed.clamp(0.0, 1.0),
    }
}
/// A cell's pull, scaled by what its places offer: each benefit multiplies it by
/// `1 + worth × felt × offer`, as the old site draws multiplied a town's pull. A seat that is
/// also a harbour draws like both; a benefit offered everywhere scales everyone alike.
pub fn valued(
    offer: impl Fn(Benefit) -> io::Result<f64>,
    threatened: f64,
    unfed: f64,
) -> io::Result<f64> {
    let mut scale = 1.0;
    for need in &NEEDS {
        let offered = offer(need.benefit)?;
        if offered > 0.0 && offered.is_finite() {
            scale *= 1.0 + need.worth * felt(need.felt, threatened, unfed) * offered;
        }
    }
    Ok(scale)
}
fn unfed(
    field: &Field,
    cell: usize,
    answers: &mut Answers<'_, Field, &'static str>,
) -> ExecutionResult<f64> {
    let living = field.people.people(cell)?;
    if living <= 0.0 {
        return Ok(0.0);
    }
    Ok((1.0 - answers.ask("support")? / living).clamp(0.0, 1.0))
}
/// The crowd that the remains of earlier places once housed and their ruined works stood for,
/// per km², at the share that still draws people back.
fn remains(field: &Field, cell: usize) -> io::Result<f64> {
    let built = field.people.view(HumanField::RuinedBuiltUp).get(cell)?;
    let works =
        field.people.view(HumanField::RuinedStanding).get(cell)? / FULL_STANDING_PER_BUILT_KM2;
    let left = built.max(works);
    if left <= 0.0 {
        return Ok(0.0);
    }
    Ok(left * PEOPLE_PER_BUILT_KM2 * REMAINS_DRAW * (1.0 + UNDER_RULE * ruled(field, cell)?))
}
/// How much more a ruin draws its founders back when a realm holds the country around it:
/// the old society cycle resettled ruins held under control.
const UNDER_RULE: f64 = 1.0;
/// Whether a realm holds the people on or beside an empty cell, 0 or 1.
fn ruled(field: &Field, cell: usize) -> io::Result<f64> {
    use crate::human::identity::{leading, Tradition};
    let held = |at| -> io::Result<bool> {
        Ok(leading(&field.people.column(at)?, Tradition::Allegiance).0 != 0)
    };
    if held(cell)? {
        return Ok(1.0);
    }
    for edge in 0..3 {
        if let Some(next) = field.mesh.neighbor(cell, edge) {
            if held(next)? {
                return Ok(1.0);
            }
        }
    }
    Ok(0.0)
}
/// The `draw` question: the people here, plus the crowd ruins' remains once housed, scaled by
/// what the places on this ground offer the people who value it.
pub fn respond(book: &mut QuestionBook<Field, &'static str>) -> ExecutionResult<()> {
    book.respond(
        "draw",
        Responder {
            by: "the people here".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|field, cell, _| Ok(field.people.people(cell)?))),
        },
    )?;
    book.respond(
        "draw",
        Responder {
            by: "the remains of earlier places".into(),
            queries: vec![],
            kind: ResponseKind::Add(Box::new(|field, cell, _| Ok(remains(field, cell)?))),
        },
    )?;
    book.respond(
        "draw",
        Responder {
            by: "the places on this ground".into(),
            queries: vec![],
            kind: ResponseKind::Scale(Box::new(|field, cell, answers| {
                let Some(offers) = field.place_offers() else {
                    return Ok(1.0);
                };
                let hungry = unfed(field, cell, answers)?;
                Ok(valued(
                    |benefit| offers.benefit(benefit, cell),
                    offers.threatened(cell)?,
                    hungry,
                )?)
            })),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{felt, valued, Felt};
    use crate::field::poi::values::Benefit;

    fn only(benefit: Benefit) -> impl Fn(Benefit) -> std::io::Result<f64> {
        move |b| Ok(f64::from(u8::from(b == benefit)))
    }

    #[test]
    fn a_seat_outdraws_a_market_and_both_outdraw_open_country() {
        let nothing = valued(|_| Ok(0.0), 0.0, 0.0).unwrap();
        assert_eq!(nothing, 1.0);
        let seat = valued(only(Benefit::Rule), 0.0, 0.0).unwrap();
        let market = valued(only(Benefit::Trade), 0.0, 0.0).unwrap();
        assert!(seat > market && market > nothing);
    }

    #[test]
    fn offers_multiply_so_a_common_benefit_does_not_drown_a_rare_one() {
        let both = valued(
            |b| {
                Ok(f64::from(u8::from(matches!(
                    b,
                    Benefit::Rule | Benefit::Sanctity
                ))))
            },
            0.0,
            0.0,
        )
        .unwrap();
        let sanctity = valued(only(Benefit::Sanctity), 0.0, 0.0).unwrap();
        let rule = valued(only(Benefit::Rule), 0.0, 0.0).unwrap();
        assert!((both / sanctity - rule).abs() < 1e-12);
    }

    #[test]
    fn food_draws_only_the_hungry_and_walls_draw_the_threatened() {
        assert_eq!(felt(Felt::WhereUnfed, 0.0, 0.0), 0.0);
        assert_eq!(felt(Felt::WhereUnfed, 0.0, 0.4), 0.4);
        assert!(felt(Felt::UnderThreat, 2.0, 0.0) > felt(Felt::UnderThreat, 0.0, 0.0));
        assert!(felt(Felt::UnderThreat, 50.0, 0.0) < 1.26);
        assert_eq!(valued(only(Benefit::Food), 0.0, 0.0).unwrap(), 1.0);
    }
}
