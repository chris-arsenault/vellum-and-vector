//! Settlement layout controls for `real-scale.settlement`, one labelled declaration each.
//! Real-scale maps show things at their real size (ADR 0016), so lengths are true metres.
//! The vocabulary the town tools share (street widths, plot sizes, building footprints and
//! house numbering) is declared in `atlas_map::town`.
/// Town development exposure after site preparation, independent of regional water rounds.
pub const DEVELOPMENT_ROUNDS: usize = 18;

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
/// A captured way drawn with no width is taken to be this wide.
pub const UNSTATED_WAY_WIDTH: f64 = 3.0;
/// Full thickness of a town wall, the width of its gates and the sides of its ring.
pub const WALL_THICKNESS: f64 = 3.0;
pub const GATE_WIDTH: f64 = 4.0;
pub const WALL_SIDES: usize = 14;
/// Mean block width in plot depths, leaving back yards between opposing frontages.
pub const BLOCK_DEPTHS: f64 = 3.0;
/// Variation in the distance between successive junctions.
pub const BLOCK_LENGTH_VARIATION: f64 = 0.22;
/// First side street's distance beyond the square, as a share of a block width.
pub const FIRST_BLOCK_SHARE: f64 = 0.6;
/// Shorter connections leave too little room between neighbouring junctions.
pub const MIN_CONNECTION_SHARE: f64 = 0.4;
/// A new street's midpoint stays this far from other streets, in block widths.
pub const STREET_CLEARANCE_SHARE: f64 = 0.25;
/// Distance in metres within which intersecting street vertices share one junction.
pub const JUNCTION_TOLERANCE: f64 = 0.01;
/// A growing street joins an existing street within this share of a block width.
pub const JOIN_SHARE: f64 = 0.45;
/// Maximum change of heading per block (radians); variation follows a street's direction.
pub const STREET_TURN: f64 = 0.16;
/// Chance of a side street at each block junction.
pub const BRANCH_CHANCE: f64 = 0.7;

// Plots.

/// Share of a place's ground its plots take; the rest is streets, yards and gaps.
pub const PACKING: f64 = 0.45;
/// Plots are drawn this share of their pitch wide, so neighbours only touch.
pub const PITCH_FILL: f64 = 0.98;
/// Ordinary parcel frontage and depth vary around their settlement-size reference.
pub const FRONTAGE_VARIATION: f64 = 0.3;
pub const DEPTH_VARIATION: f64 = 0.2;
/// Buildings use this range of their fitted envelope rather than repeating one footprint.
pub const BUILDING_ENVELOPE_MIN: f64 = 0.8;
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
