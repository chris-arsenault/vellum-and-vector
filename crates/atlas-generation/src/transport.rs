//! Shared physical transport contracts used by every carried owner.
pub mod carriers;
pub mod overlap;
pub mod plan;
pub mod quantities;
pub mod scatter;
use crate::storage::ReadBand;
/// Source-indexed rows, weighted in the source's represented area.
pub struct TransportShares {
    pub offsets: ReadBand<u32>,
    pub targets: ReadBand<i32>,
    pub weights: ReadBand<f64>,
    pub dominant: ReadBand<i32>,
}
pub struct HistoryTransport {
    pub shares: TransportShares,
    pub arrivals: ReadBand<f64>,
}
pub const TRANSPORT_WEIGHT_SCALE: f64 = 1_000_000.0;
/// Target-indexed surviving overlap, weighted in the target's represented area.
pub struct GroundArrivals {
    pub offsets: ReadBand<u32>,
    pub sources: ReadBand<u32>,
    pub weights: ReadBand<f64>,
}
pub struct DeformationBands {
    pub xx: ReadBand<f64>,
    pub xy: ReadBand<f64>,
    pub yx: ReadBand<f64>,
    pub yy: ReadBand<f64>,
}
impl DeformationBands {
    pub fn at(&self, cell: usize) -> std::io::Result<[f64; 4]> {
        Ok([
            self.xx.get(cell)?,
            self.xy.get(cell)?,
            self.yx.get(cell)?,
            self.yy.get(cell)?,
        ])
    }
}
