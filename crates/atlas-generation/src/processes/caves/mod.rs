//! Caves beneath a real-scale ground map (ADR 0016). Each opens through its own cause: groundwater
//! dissolves soluble rock along its own flow toward springs, lava drains from beneath its crust,
//! stress opens joints in fractured hard rock, and Fire's veins hold conduits open through the
//! fracture network. Greenwood's failed water dissolves sinkholes whatever the rock. The process
//! reads the map's own ground and returns caves in the map's metres; the state adapter publishes.
pub mod dissolved;
pub mod host;
pub mod network;
pub mod settings;
pub mod shape;
pub mod traced;
pub use host::{Bed, Form, Host, Magic, Signs};
use settings::{CHAMBER_FRACTURE, CHAMBER_SIDES, CHAMBER_WIDTHS};
pub use shape::Vertex;

/// What the process reads at one lattice cell.
#[derive(Clone, Debug)]
pub struct Cell {
    pub position: [f64; 2],
    /// Cell area, square metres.
    pub area: f64,
    pub neighbours: network::Neighbours,
    pub host: Option<Host>,
    /// Where this cell's groundwater moves to.
    pub groundwater: Option<usize>,
    /// Where this cell's surface water moves to.
    pub downhill: Option<usize>,
    /// Ground elevation, metres.
    pub ground: f64,
    /// Water soaks into the ground here.
    pub recharges: bool,
    /// Fracture openness, conductance per thousand.
    pub fracture: f64,
    /// Dry, ice-free land, where a passage meeting the ground opens to the air.
    pub opens: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Opening {
    /// A passage meets the ground at a valley side, spring or tube end.
    Mouth,
    /// The ground has fallen into a passage below; a shaft drops to it when it lies deep.
    Sinkhole,
    /// A lava tube's roof has fallen in.
    Skylight,
}
impl Opening {
    pub fn kind(self) -> &'static str {
        match self {
            Self::Mouth => "caveMouth",
            Self::Sinkhole => "sinkhole",
            Self::Skylight => "skylight",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Mouth => "Cave mouth",
            Self::Sinkhole => "Sinkhole",
            Self::Skylight => "Skylight",
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct Passage {
    pub form: Form,
    pub magic: Option<Magic>,
    pub vertices: Vec<Vertex>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Chamber {
    pub outline: Vec<[f64; 2]>,
    pub depth: f64,
    pub passage: usize,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Entrance {
    pub opening: Opening,
    pub position: [f64; 2],
    /// Depth of the passage the entrance reaches; deeper than a mouth, a shaft drops to it.
    pub depth: f64,
    pub passage: usize,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Cave {
    pub form: Form,
    pub magic: Option<Magic>,
    pub passages: Vec<Passage>,
    pub chambers: Vec<Chamber>,
    pub entrances: Vec<Entrance>,
}
impl Cave {
    fn new(form: Form) -> Self {
        Self {
            form,
            magic: None,
            passages: Vec::new(),
            chambers: Vec::new(),
            entrances: Vec::new(),
        }
    }
    /// Adds a passage through these cells and returns its index.
    fn add(&mut self, cells: &[Cell], run: &[usize], at: impl Fn(usize) -> (f64, f64)) -> usize {
        let magic = run
            .iter()
            .find_map(|&c| cells[c].host.and_then(|h| h.magic));
        self.magic = self.magic.or(magic);
        let vertices: Vec<Vertex> = run
            .iter()
            .map(|&cell| {
                let (width, depth) = at(cell);
                Vertex {
                    position: cells[cell].position,
                    width,
                    depth,
                }
            })
            .collect();
        self.passages.push(Passage {
            form: self.form,
            magic,
            vertices: shape::smooth(&vertices),
        });
        self.passages.len() - 1
    }
    fn chamber(&mut self, centre: [f64; 2], width: f64, depth: f64, passage: usize) {
        self.chambers.push(Chamber {
            outline: shape::outline(centre, width * CHAMBER_WIDTHS, CHAMBER_SIDES),
            depth,
            passage,
        });
    }
    /// Chambers where an open fracture crosses the passage: its strongest point along the run.
    fn fracture_chambers(
        &mut self,
        cells: &[Cell],
        run: &[usize],
        passage: usize,
        at: impl Fn(usize) -> (f64, f64),
    ) {
        for window in run.windows(3) {
            let [before, cell, after] = [window[0], window[1], window[2]];
            let open = cells[cell].fracture;
            if open >= CHAMBER_FRACTURE
                && open > cells[before].fracture
                && open > cells[after].fracture
            {
                let (width, depth) = at(cell);
                self.chamber(cells[cell].position, width, depth, passage);
            }
        }
    }
    fn open(&mut self, opening: Opening, cell: &Cell, depth: f64, passage: usize) {
        if cell.opens {
            self.entrances.push(Entrance {
                opening,
                position: cell.position,
                depth,
                passage,
            });
        }
    }
}
/// Every cave beneath the map.
pub fn plan(cells: &[Cell]) -> Vec<Cave> {
    let mut caves = dissolved::caves(cells);
    caves.extend(traced::tubes(cells));
    for form in [Form::Fissure, Form::Thermal] {
        caves.extend(traced::fractured(cells, form));
    }
    caves
}
