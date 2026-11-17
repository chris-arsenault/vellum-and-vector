//! Settlement layout controls for `real-scale.settlement`, one labelled declaration each.
//! Real-scale maps show things at their real size (ADR 0016), so lengths are true metres.
//! The vocabulary the town tools share (street widths, plot sizes, building footprints and
//! house numbering) is declared in `atlas_map::town`.
use super::story::Size;

// The plan's working grid.

/// The finest grid cell, fine enough for town plots; a wide map uses coarser cells.
pub const FINEST_CELL: f64 = 1.5;
/// The most grid cells across the map's longer side.
pub const MOST_CELLS_ACROSS: f64 = 1_600.0;
/// Slope (rise over run) beyond which nobody builds or ploughs.
pub const STEEP_SLOPE: f64 = 0.35;

// Streets.

/// Vertex spacing of generated streets, so widths can vary along them.
pub const VERTEX_STEP: f64 = 10.0;
/// Half the side of a place's market square; hamlets and farmsteads have none.
pub fn square_half(size: Size) -> f64 {
    match size {
        Size::City => 30.0,
        Size::Town => 20.0,
        Size::Village => 12.0,
        Size::Hamlet | Size::Farmstead => 0.0,
    }
}
/// A captured way drawn with no width is taken to be this wide.
pub const UNSTATED_WAY_WIDTH: f64 = 3.0;
/// Full thickness of a town wall, the width of its gates and the sides of its ring.
pub const WALL_THICKNESS: f64 = 3.0;
pub const GATE_WIDTH: f64 = 4.0;
pub const WALL_SIDES: usize = 14;
/// Lanes grown to house waiting people reach this many plot depths in the first round and
/// one more each round after.
pub const GROWN_LANE_DEPTHS: f64 = 4.0;

// Plots.

/// Share of a place's ground its plots take; the rest is streets, yards and gaps.
pub const PACKING: f64 = 0.45;
/// Plots are drawn this share of their pitch wide, so neighbours only touch.
pub const PITCH_FILL: f64 = 0.98;
/// A plot on a main street counts as this share of its distance from the centre, so a place
/// fills its main streets before its lanes.
pub const MAIN_STREET_PULL: f64 = 0.85;

// Fields.

/// A field block's mean side and a ploughed strip's mean width.
pub const FIELD_BLOCK: f64 = 220.0;
pub const FIELD_STRIP: f64 = 22.0;
/// Ground left unploughed between neighbouring blocks, and between a block and a way.
pub const BALK: f64 = 4.0;
pub const FIELD_VERGE: f64 = 5.0;
/// Blocks this many block sides beyond a built edge are still worked in strips.
pub const STRIP_REACH: f64 = 3.0;
/// Share of scattered field seeds left out, so neighbouring blocks merge into larger ones.
pub const MERGED: f64 = 0.3;
