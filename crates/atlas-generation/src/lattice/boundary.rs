//! Boundary support: the only form in which anything beyond a map's edge exists.
//!
//! A map's lattice addresses map cells only. Numerical kernels that need an edge condition
//! read this structure explicitly; no cell index ever names a ghost.

/// Channels with captured ghost values. Without them a kernel clamps to the edge cell's value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GhostChannel {
    /// The parent's surface elevation, in native length units, beyond a refined map's edge.
    Elevation,
}
impl GhostChannel {
    pub const ALL: &'static [Self] = &[Self::Elevation];
    const COUNT: usize = 1;
    fn index(self) -> usize {
        match self {
            Self::Elevation => 0,
        }
    }
}

/// One missing neighbour of a map edge cell.
#[derive(Clone, Copy, Debug)]
pub struct Crossing {
    pub cell: usize,
    pub edge: usize,
    /// Ghost slot across this edge.
    pub slot: usize,
    /// Lattice-local centroid of the ghost across the edge.
    pub position: [f64; 2],
    /// Centroid distance across the edge.
    pub length: f64,
    /// Length of the shared face.
    pub face: f64,
}

/// One outside position of the lattice frame, carrying the column of its owning edge cell.
#[derive(Clone, Copy, Debug)]
pub struct Ghost {
    /// Lattice-local centroid.
    pub position: [f64; 2],
    pub inverted: bool,
    /// The map edge cell whose column a zero-gradient edge condition extends here.
    pub owner: usize,
}

#[derive(Default)]
pub struct BoundarySupport {
    crossings: Vec<Crossing>,
    ghosts: Vec<Ghost>,
    values: [Option<Box<[f64]>>; GhostChannel::COUNT],
}
impl BoundarySupport {
    /// Crossings in cell then edge order; ghosts in owner order.
    pub(super) fn new(crossings: Vec<Crossing>, ghosts: Vec<Ghost>) -> Self {
        Self {
            crossings,
            ghosts,
            values: Default::default(),
        }
    }
    pub fn crossings(&self) -> &[Crossing] {
        &self.crossings
    }
    pub fn crossings_of(&self, cell: usize) -> &[Crossing] {
        let start = self.crossings.partition_point(|c| c.cell < cell);
        let end = self.crossings.partition_point(|c| c.cell <= cell);
        &self.crossings[start..end]
    }
    pub fn ghosts(&self) -> &[Ghost] {
        &self.ghosts
    }
    /// The ghosts whose column the edge cell `cell` supplies.
    pub fn owned_by(&self, cell: usize) -> &[Ghost] {
        let start = self.ghosts.partition_point(|g| g.owner < cell);
        let end = self.ghosts.partition_point(|g| g.owner <= cell);
        &self.ghosts[start..end]
    }
    /// The captured ghost value in `slot`. `None` means the stated world rule applies:
    /// clamp to the edge cell's own value.
    pub fn ghost(&self, channel: GhostChannel, slot: usize) -> Option<f64> {
        self.values[channel.index()]
            .as_ref()
            .map(|values| values[slot])
    }
    pub(super) fn capture(
        &mut self,
        channel: GhostChannel,
        values: Vec<f64>,
    ) -> Result<(), &'static str> {
        if values.len() != self.ghosts.len() {
            return Err("Ghost values need one value per ghost");
        }
        self.values[channel.index()] = Some(values.into_boxed_slice());
        Ok(())
    }
}
