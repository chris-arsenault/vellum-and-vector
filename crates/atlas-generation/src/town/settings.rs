//! Settlement layout controls for `real-scale.settlement`, one labelled declaration each.
//! Real-scale maps show things at their real size (ADR 0016), so lengths are true metres.
//! The vocabulary the town tools share (street widths, plot sizes, building footprints and
//! house numbering) is declared in `atlas_map::town`.
//!
//! Every length here is declared in street metres: its value at street fidelity. Each names
//! the `Measure` it is resolved by (`super::scale`), and its uses read it through the town's
//! scale, so a town at another fidelity gets that fidelity's length.
/// Town development exposure after site preparation, independent of regional water rounds.
pub const DEVELOPMENT_ROUNDS: usize = 18;

/// The farthest walk, in travel-cost metres, that daily work, custom and town services
/// draw across: about twenty minutes on foot. A draw fades over the second half of this
/// distance and is gone at it, so a town's far side no longer pulls on every door.
/// Street metres, resolved by `Measure::Travel`.
pub const DAILY_REACH: f64 = 1_600.0;
/// Characteristic walking cost for public services around their entrance. Street metres,
/// resolved by `Measure::Travel`.
pub const SERVICE_REACH: f64 = 100.;
/// Characteristic walking cost for consultation and instruction. Street metres, resolved by
/// `Measure::Travel`.
pub const LEARNING_REACH: f64 = 180.;
/// Local frontage and nuisance exposure neighborhood. Street metres, resolved by
/// `Measure::Adjacency`.
pub const PREMISES_REACH: f64 = 100.;
/// Units of local occupation one fully active service premises can support; a holding
/// supports this many for each premises it stands for (`TownScale::premises`).
pub const SERVICE_CAPACITY: f64 = 36.;
/// Walking costs for ordinary visits from the house and from the countryside. Street metres,
/// resolved by `Measure::Travel`.
pub const TOWNSFOLK_REACH: f64 = 360.;
pub const COUNTRYFOLK_REACH: f64 = 720.;
/// The travel cost at which a source draws a site half as strongly as at its door. Street
/// metres, resolved by `Measure::Travel`.
pub const HALF_PULL: f64 = 180.;

// The plan's working grid.

/// The finest grid cell, fine enough for town plots; a wide map uses coarser cells. Street
/// metres, resolved by `Measure::Ground`.
pub const FINEST_CELL: f64 = 1.5;
/// The most grid cells across the map's longer side.
pub const MOST_CELLS_ACROSS: f64 = 1_600.0;
/// Slope (rise over run) beyond which nobody builds or ploughs.
pub const STEEP_SLOPE: f64 = 0.35;

// Streets.

/// Vertex spacing of generated streets, so widths can vary along them. Street metres,
/// resolved by `Measure::Layout`.
pub const VERTEX_STEP: f64 = 10.0;
/// A captured way drawn with no width is taken to be this wide. Street metres, resolved by
/// `Measure::Width`.
pub const UNSTATED_WAY_WIDTH: f64 = 3.0;
/// Full thickness of a town wall and the width of its gates. Street metres, resolved by
/// `Measure::Width`.
pub const WALL_THICKNESS: f64 = 3.0;
pub const GATE_WIDTH: f64 = 4.0;
/// The width a wall's line takes on the town ground. Street metres, resolved by
/// `Measure::Width`.
pub const WALL_LINE: f64 = 1.0;
/// The narrowest way a cart passes, and the width a loaded street widens from. Street
/// metres, resolved by `Measure::Width`.
pub const FREIGHT_WIDTH: f64 = 2.4;
/// Shorter connections leave too little room between neighbouring junctions.
pub const MIN_CONNECTION_SHARE: f64 = 0.4;
/// A new street's midpoint stays this far from other streets, in block widths.
pub const STREET_CLEARANCE_SHARE: f64 = 0.25;
/// Distance in metres within which intersecting street vertices share one junction. A
/// geometric precision, not a measure of the town: it is the same at every fidelity.
pub const JUNCTION_TOLERANCE: f64 = 0.01;
/// A growing street joins an existing street within this share of a block width.
pub const JOIN_SHARE: f64 = 0.45;

// Plots.

/// Plots are drawn this share of their pitch wide, so neighbours only touch.
pub const PITCH_FILL: f64 = 0.98;
/// Ordinary parcel frontage and depth vary around their settlement-size reference.
pub const FRONTAGE_VARIATION: f64 = 0.3;
pub const DEPTH_VARIATION: f64 = 0.2;
/// The frontage of the plots a founding surveys. Street metres, resolved by `Measure::Plot`.
/// The plots each later round offers take their size from the town's order.
pub const FOUNDING_FRONTAGE: f64 = 10.;
/// How far from inhabited sites a round surveys open land. Street metres, resolved by
/// `Measure::Layout`.
pub const CANDIDATE_REACH: f64 = 50.;

// Fields.

/// A field block's mean side and a ploughed strip's mean width. Street metres, resolved by
/// `Measure::Plot`.
pub const FIELD_BLOCK: f64 = 220.0;
pub const FIELD_STRIP: f64 = 22.0;
