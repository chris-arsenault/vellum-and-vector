//! Cave controls, one labelled declaration each. Caves exist only on real-scale maps, where
//! things stand at their real size (ADR 0016), so these lengths are true metres.

/// How far below the ground a bed can hold the caves a real-scale map shows, in metres.
pub const REACH: f64 = 120.0;
/// Catalogue solubility from which moving groundwater dissolves a bed into passages.
pub const SOLUBLE_FROM: f64 = 0.5;
/// Fracture openness (conductance per thousand) from which standing rock opens into fissures.
pub const OPEN_FROM: f64 = 0.45;
/// Rock strength from which an opened joint stands as a fissure rather than closing.
pub const STANDS_FROM: f64 = 1200.0;
/// Depth of the bed top, in metres, within which a lava flow's crust still roofs a tube.
pub const TUBE_CRUST: f64 = 2.0;
/// Groundwater catchment, in square metres, from which the flow has dissolved a passage.
pub const CONDUIT_FROM: f64 = 20_000.0;
/// A dissolved passage's width per square root of its catchment, in metres per metre.
pub const WIDTH_PER_ROOT_CATCHMENT: f64 = 0.012;
/// Fall of a dissolved passage toward its outlet, in metres per metre.
pub const CONDUIT_GRADIENT: f64 = 0.01;
/// A fissure's width at the opening threshold, in metres; wider where fractures open more.
pub const FISSURE_WIDTH: f64 = 0.8;
/// Depth of a fissure's walkable floor below the top of its bed, in metres.
pub const FISSURE_FLOOR: f64 = 8.0;
/// Shortest fissure, thermal passage or lava tube a cave holds, in metres.
pub const SHORTEST_PASSAGE: f64 = 40.0;
/// A lava tube's width, in metres.
pub const TUBE_WIDTH: f64 = 6.0;
/// Rock over a lava tube's roof, in metres.
pub const TUBE_ROOF: f64 = 4.0;
/// Distance along a lava tube between roof collapses that open skylights, in metres.
pub const SKYLIGHT_SPACING: f64 = 180.0;
/// A passage this close below the ground, in metres, opens at a cave mouth.
pub const MOUTH_DEPTH: f64 = 3.0;
/// Depth of each cave level, in metres below the ground.
pub const LEVEL_DEPTH: f64 = 30.0;
/// Fracture openness at which a fracture crossing a passage opens a chamber.
pub const CHAMBER_FRACTURE: f64 = 0.7;
/// A chamber's radius in widths of the passage through it.
pub const CHAMBER_WIDTHS: f64 = 2.5;
/// Sides of a chamber's drawn outline.
pub const CHAMBER_SIDES: usize = 12;
