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
pub mod settings;
pub mod site;
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
    let field = state.field();
    let target = site::farmed(field)?;
    let fields = farm(
        &plans,
        &site.ways,
        site.bounds,
        &mut ground,
        (target, &|p: Point| {
            site::shares(field, p).unwrap_or((0.0, 0.0))
        }),
    );
    records::publish(state, &plans, &fields)
}
/// How many square metres to farm, and the farmland and pasture shares at a point.
type Farmed<'a> = (f64, &'a dyn Fn(Point) -> (f64, f64));
/// Fields around the places, kept clear of every way on the map: the settlements' streets and
/// the captured roads, tracks and trails, which are marked on the grid first.
fn farm(
    plans: &[Plan],
    map_ways: &[(Vec<Point>, f64)],
    bounds: [f64; 4],
    ground: &mut ground::Ground,
    (target, share): Farmed<'_>,
) -> Vec<fields::Field> {
    for (line, width) in map_ways {
        ground.take_line(line, *width, ground::WAY);
    }
    let places = plans
        .iter()
        .map(|p| (p.seat.centre, p.built))
        .collect::<Vec<_>>();
    let ways = plans
        .iter()
        .flat_map(|p| p.streets.iter().map(|s| s.points.clone()))
        .chain(map_ways.iter().map(|(line, _)| line.clone()))
        .collect::<Vec<_>>();
    let key = plans.first().map_or("country", |p| p.seat.key.as_str());
    let country = Country {
        places: &places,
        ways: &ways,
        bounds,
        block: settings::FIELD_BLOCK,
        strip: settings::FIELD_STRIP,
        key,
    };
    fields(&country, ground, target, share)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fields_keep_clear_of_a_captured_trail_where_no_settlement_stands() {
        let trail = vec![[0.0, 1_000.0], [2_000.0, 1_000.0]];
        let mut ground = ground::Ground::new([0.0, 0.0, 2_000.0, 2_000.0], 5.0);
        let everywhere = |_: Point| (1.0, 0.0);
        let fields = farm(
            &[],
            &[(trail, 3.0)],
            [0.0, 0.0, 2_000.0, 2_000.0],
            &mut ground,
            (f64::MAX, &everywhere),
        );
        assert!(!fields.is_empty());
        for field in &fields {
            let ys = field.corners.iter().map(|p| p[1] - 1_000.0);
            let (low, high) = ys.fold((f64::MAX, f64::MIN), |(l, h), y| (l.min(y), h.max(y)));
            assert!(low >= 0.0 || high <= 0.0, "a field spans the trail");
        }
        assert_eq!(ground.owner([700.0, 1_000.0]), ground::WAY);
    }
    #[test]
    fn every_layout_choice_parses() {
        for layout in &LAYOUTS[1..] {
            assert!(Layout::parse(layout).is_some());
        }
    }
}
