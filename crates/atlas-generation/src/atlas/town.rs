//! `real-scale.settlement`: on a real-scale ground map, the settlements generated there are
//! laid out as streets, plots, buildings, fields and wards (ADR 0016, settlement plan).
//! The parent's settlement records are starting conditions: their people size the place and
//! their story picks its layout; nothing is fitted back to them.
pub mod addresses;
pub mod fields;
pub mod geometry;
pub mod ground;
pub mod lanes;
pub mod network;
pub mod plan;
pub mod plots;
mod records;
mod site;
pub mod story;
pub mod uses;
pub mod wards;
use super::state::State;
use crate::{
    execution::{Command, CommandKind},
    field::refinement::people,
};
use fields::{fields, Country};
use geometry::Point;
use plan::Plan;
use std::io;
use story::Layout;

/// The process's settings: a layout the creator forces, or none to let each settlement's
/// story choose.
pub struct Settings {
    pub layout: Option<Layout>,
}
/// The layout setting's choices; `story` lets each settlement's own story decide.
pub const LAYOUTS: [&str; 6] = ["story", "organic", "grid", "radial", "linear", "walled"];
pub fn operation() -> Command<State, Settings> {
    Command::with_inputs(
        "real-scale.settlement",
        CommandKind::Publish,
        vec![],
        |scope, settings: &Settings| {
            lay_out(scope.state_mut(), settings.layout)?;
            Ok(())
        },
    )
}
fn lay_out(state: &mut State, forced: Option<Layout>) -> io::Result<()> {
    let peopled = state
        .regional
        .as_ref()
        .is_some_and(|r| people::enabled(&r.domains));
    if !peopled {
        return Ok(());
    }
    let site = site::read(state)?;
    let mut ground = site.ground;
    let plans = site
        .seats
        .into_iter()
        .map(|seat| plan::lay(seat, &mut ground, forced))
        .collect::<Vec<_>>();
    let fields = farm(state, &plans, site.bounds, &mut ground)?;
    records::publish(state, &plans, &fields)
}
/// A field block's mean side and a ploughed strip's mean width, in metres: fields on a
/// real-scale map are their real size whatever the map's extent.
const FIELD_BLOCK: f64 = 220.0;
const FIELD_STRIP: f64 = 22.0;
fn farm(
    state: &State,
    plans: &[Plan],
    bounds: [f64; 4],
    ground: &mut ground::Ground,
) -> io::Result<Vec<fields::Field>> {
    let places = plans
        .iter()
        .map(|p| (p.seat.centre, p.built))
        .collect::<Vec<_>>();
    let ways = plans
        .iter()
        .flat_map(|p| p.streets.iter().map(|s| s.points.clone()))
        .collect::<Vec<_>>();
    let key = plans.first().map_or("country", |p| p.seat.key.as_str());
    let country = Country {
        places: &places,
        ways: &ways,
        bounds,
        block: FIELD_BLOCK,
        strip: FIELD_STRIP,
        key,
    };
    let field = state.field();
    let target = site::farmed(field)?;
    Ok(fields(&country, ground, target, |p: Point| {
        site::shares(field, p).unwrap_or((0.0, 0.0))
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_layout_choice_parses() {
        for layout in &LAYOUTS[1..] {
            assert!(Layout::parse(layout).is_some());
        }
    }
}
