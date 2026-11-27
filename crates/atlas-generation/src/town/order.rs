//! How a town is ordered. The causes that vary a town write these terms, and the rules
//! that build it (street laying, crossings, plot survey) read them where they would
//! otherwise hold a number of their own. Two causes write today: the map's settings, and
//! the settlement's civic order over them. Each term is a declared setting whose default
//! is the value every town had before any cause wrote it.
//!
//! Lengths are street metres, resolved through the town's scale where they are read.
use crate::parameters::NumericParameter;
use crate::processes::strategies::MapType;
use serde::{Deserialize, Serialize};
use std::io;

/// A term with its default and the least value a map may give it. A plot or a spacing of
/// no size would never let a survey step forward, so lengths have a least size.
const fn term(
    name: &'static str,
    unit: &'static str,
    [default, least]: [f64; 2],
) -> NumericParameter {
    NumericParameter {
        name,
        unit,
        default,
        minimum: Some(least),
        maximum: None,
        strategy: None,
        map_types: &[MapType::Street],
    }
}
const STREET_SPACING: NumericParameter = term("streetSpacing", "street metres", [60., 5.]);
const BACK_LANE: NumericParameter = term("backLaneReach", "street metres", [20., 1.]);
const CROSSING_SPACING: NumericParameter = term("crossingSpacing", "plot depths", [5., 1.]);
const SHORTCUT_SAVING: NumericParameter = NumericParameter {
    maximum: Some(1.),
    ..term("shortcutSaving", "share of the walk", [0.4, 0.])
};
const STREET_WORK: NumericParameter = term("streetWorkShare", "effort per resident", [0.12, 0.]);
const PLOT_FRONTAGE: NumericParameter = term("plotFrontage", "street metres", [9., 2.]);
const PLOT_DEPTH: NumericParameter = term("plotDepth", "street metres", [25., 4.]);
pub const CONTROLS: &[NumericParameter] = &[
    STREET_SPACING,
    BACK_LANE,
    CROSSING_SPACING,
    SHORTCUT_SAVING,
    STREET_WORK,
    PLOT_FRONTAGE,
    PLOT_DEPTH,
];

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Order {
    /// The least spacing a new route keeps from the streets it does not join.
    pub street_spacing: f64,
    /// How far behind a deep plot a back lane runs.
    pub back_lane: f64,
    /// The spacing of a main street's major crossings, in plot depths.
    pub crossing_spacing: f64,
    /// The share of a walk a shortcut must save before two street ends are joined.
    pub shortcut_saving: f64,
    /// The street work each participating resident supplies in a round.
    pub street_work: f64,
    /// The frontage and depth of the plots offered on open frontage each round.
    pub plot_frontage: f64,
    pub plot_depth: f64,
}
impl Default for Order {
    fn default() -> Self {
        Self {
            street_spacing: STREET_SPACING.default,
            back_lane: BACK_LANE.default,
            crossing_spacing: CROSSING_SPACING.default,
            shortcut_saving: SHORTCUT_SAVING.default,
            street_work: STREET_WORK.default,
            plot_frontage: PLOT_FRONTAGE.default,
            plot_depth: PLOT_DEPTH.default,
        }
    }
}
impl Order {
    /// The order a map's settings give before any cause writes to it.
    pub fn from_input(input: &crate::atlas::dispatch::Input) -> io::Result<Self> {
        Ok(Self {
            street_spacing: input.number(STREET_SPACING.name)?,
            back_lane: input.number(BACK_LANE.name)?,
            crossing_spacing: input.number(CROSSING_SPACING.name)?,
            shortcut_saving: input.number(SHORTCUT_SAVING.name)?,
            street_work: input.number(STREET_WORK.name)?,
            plot_frontage: input.number(PLOT_FRONTAGE.name)?,
            plot_depth: input.number(PLOT_DEPTH.name)?,
        })
    }
}
