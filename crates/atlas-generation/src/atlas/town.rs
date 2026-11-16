//! `real-scale.settlement`: on a real-scale ground map, the settlements generated there are
//! laid out as streets, plots, buildings, fields and wards (ADR 0016, settlement plan).
//! The parent's settlement records are starting conditions: their people size the place and
//! their story picks its layout; nothing is fitted back to them.
pub mod addresses;
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
use geometry::{sub, unit, Point};
use plan::Plan;
use plots::{fields, Country};
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
/// Field blocks are pitched to the map: a wide map's fields are larger.
fn field_size(bounds: [f64; 4]) -> (f64, f64) {
    let side = (bounds[2] - bounds[0]).max(bounds[3] - bounds[1]);
    let width = (side / 120.0).clamp(50.0, 250.0);
    (width, 2.5 * width)
}
fn farm(
    state: &State,
    plans: &[Plan],
    bounds: [f64; 4],
    ground: &mut ground::Ground,
) -> io::Result<Vec<plots::Field>> {
    let mut places = plans
        .iter()
        .map(|p| (p.seat.centre, p.built))
        .collect::<Vec<_>>();
    if places.is_empty() {
        places.push((
            [(bounds[0] + bounds[2]) / 2.0, (bounds[1] + bounds[3]) / 2.0],
            0.0,
        ));
    }
    let axis = plans
        .first()
        .and_then(|p| p.streets.first())
        .map_or([1.0, 0.0], |s| unit(sub(s.points[1], s.points[0])));
    let (width, depth) = field_size(bounds);
    let country = Country {
        places: &places,
        axis,
        bounds,
        width,
        depth,
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
    fn fields_are_pitched_to_the_map() {
        assert_eq!(field_size([0.0, 0.0, 300.0, 225.0]), (50.0, 125.0));
        assert_eq!(
            field_size([0.0, 0.0, 20_000.0, 15_000.0]).0,
            20_000.0 / 120.0
        );
        for layout in &LAYOUTS[1..] {
            assert!(Layout::parse(layout).is_some());
        }
    }
}
