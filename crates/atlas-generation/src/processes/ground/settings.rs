//! Real-scale ground controls, one labelled declaration each. These maps show things at their
//! real size (ADR 0016), so lengths are true metres and discharges cubic metres a second.
use crate::magic::surface::Surface;

// Channels: downstream hydraulic geometry. Width grows with the square root of discharge, by
// a coefficient of the bed's rock family (`RockFamily::channel_width_per_root_discharge`), and
// mean velocity with its tenth power; depth follows from carrying the discharge at that width
// and velocity.

/// Mean velocity of a channel carrying one cubic metre a second, in metres a second.
pub const VELOCITY_AT_UNIT_DISCHARGE: f64 = 0.7;
/// How mean velocity grows with discharge.
pub const VELOCITY_EXPONENT: f64 = 0.1;

// Pools.

/// The stretch over which a channel's own gradient is measured, in channel widths.
pub const GRADIENT_WINDOW: f64 = 4.0;
/// The reach whose mean gradient a stretch is compared with, in channel widths.
pub const REACH_WINDOW: f64 = 40.0;
/// A stretch whose gradient is below this share of its reach's mean holds slack water.
pub const SLACK_SHARE: f64 = 0.35;
/// A bend tighter than this radius, in channel widths, scours a pool on its outside.
pub const TIGHT_BEND: f64 = 3.0;
/// The distance either side of a vertex over which its bend is measured, in channel widths.
pub const BEND_WINDOW: f64 = 1.0;
/// Pools stand at least this far apart along a channel, in channel widths, as pools and
/// riffles alternate.
pub const POOL_SPACING: f64 = 5.0;
/// A tributary joins this piece of a channel when it meets within this many channel widths
/// of the line; a junction farther off belongs to another piece.
pub const JUNCTION_REACH: f64 = 2.0;
/// A pool's length along the flow and its breadth across, in channel widths.
pub const POOL_LENGTH: f64 = 2.5;
pub const POOL_BREADTH: f64 = 1.5;
/// A bend pool's centre lies this far toward the outside of the bend, in channel widths.
pub const BEND_OFFSET: f64 = 0.25;
/// A pool is this many times as deep as the channel around it.
pub const POOL_DEEPENING: f64 = 2.0;
/// Corners of a pool's drawn outline.
pub const POOL_SIDES: usize = 16;

// Crossings.

/// Water shallower than this, in metres, is waded.
pub const FORD_DEPTH: f64 = 1.0;
/// A crossing this close to an existing bridge or ford uses it: a fixed reach in metres plus
/// this many channel widths.
pub const CROSSING_REACH: f64 = 10.0;
pub const CROSSING_REACH_WIDTHS: f64 = 2.0;
/// A bridge deck is this much wider than the way it carries, in metres.
pub const DECK_MARGIN: f64 = 1.0;

// Exposed rock.

/// Loose cover thinner than this, in metres, leaves the rock beneath showing.
pub const BARE_COVER: f64 = 0.3;
/// The steepest slope loose cover holds, rise over run: the angle of repose of debris, about
/// 35 degrees.
pub const HOLDING_SLOPE: f64 = 0.7;
/// Rock steeper than this, rise over run (about 55 degrees), stands as a cliff.
pub const CLIFF_SLOPE: f64 = 1.4;
/// The shortest steep band, in metres, that reads as a cliff.
pub const CLIFF_LENGTH: f64 = 10.0;
/// A steep band reads as a cliff when it is at least this many times as long as it is wide.
pub const CLIFF_ELONGATION: f64 = 3.0;

// Trails.

/// The grade, rise over run, at which walking costs twice as much as on the level; the cost
/// grows with the square of the grade.
pub const TRAIL_GRADE: f64 = 0.15;
/// Extra walking cost through full tree cover and through full wetland.
pub const DENSE_COVER_COST: f64 = 2.0;
pub const WET_COST: f64 = 3.0;
/// Walking cost across water too deep to wade, and across a shallow crossing.
pub const WATER_COST: f64 = 40.0;
pub const FORD_COST: f64 = 3.0;
/// A laid trail's triangles cost this share of their walking cost, so later trails join it.
pub const WORN_SHARE: f64 = 0.4;
/// A place this close to a way, in metres, is reached and needs no trail.
pub const REACHED_WITHIN: f64 = 20.0;
/// A trail's width where one party walks it and where many trails have joined, in metres.
pub const TRAIL_NARROW: f64 = 1.0;
pub const TRAIL_WIDE: f64 = 2.0;
/// Corner-cutting passes that round a trail's line between triangle centres.
pub const TRAIL_SMOOTHING: usize = 2;

// Cover objects.

/// Single plants and stones stand on maps whose hexes are at most this many metres across.
pub const COVER_HEX: f64 = 10.0;
/// Candidate positions tried for each object a triangle should hold.
pub const ATTEMPTS: usize = 4;
/// One kind of single object: how close two may stand and how many stand on a square metre
/// of full cover. Its real size is the catalogue's (`catalogue.json` `sizes`, `objects:<kind>`).
pub struct ObjectKind {
    pub kind: &'static str,
    pub label: &'static str,
    pub spacing: f64,
    pub density: f64,
}
/// Trees by their crowns (closed forest holds a few hundred a hectare), shrubs, boulders and
/// reed clumps, in the order of `cover::Cover`.
pub const OBJECTS: [ObjectKind; 4] = [
    ObjectKind {
        kind: "tree",
        label: "Tree",
        spacing: 4.0,
        density: 0.03,
    },
    ObjectKind {
        kind: "shrub",
        label: "Shrub",
        spacing: 1.5,
        density: 0.15,
    },
    ObjectKind {
        kind: "boulder",
        label: "Boulder",
        spacing: 1.0,
        density: 0.08,
    },
    ObjectKind {
        kind: "reeds",
        label: "Reeds",
        spacing: 1.0,
        density: 0.3,
    },
];
/// Surfaces whose ground is scrub (shrubs) and scree (boulders), by the classifier's names.
pub const SCRUB_SURFACES: [Surface; 5] = [
    Surface::Tundra,
    Surface::WetTundra,
    Surface::ColdSteppe,
    Surface::Savanna,
    Surface::FogHeath,
];
pub const SCREE_SURFACES: [Surface; 2] = [Surface::ScreeField, Surface::Moraine];
