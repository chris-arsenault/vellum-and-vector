use crate::storage::{Band, Coverage, ReadBand};
/// Scalar placement and its projections. Material columns remain in RockColumns.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(usize)]
pub enum GroundField {
    Elevation,
    BedrockElevation,
    CrustSupportElevation,
    CrustSupportTarget,
    SurfaceRockLoad,
    CrustThickness,
    CrustContinentalColumn,
    CrustContinentalFraction,
    CrustRootReserve,
    SedimentThickness,
    RockResistance,
    RockKindCodes,
    GroundCutShare,
    GroundCutDepth,
    GroundCutCover,
    StructuralGrainX,
    StructuralGrainY,
    ThrustPairIds,
    ThrustSheetIndex,
    ThrustSegmentIds,
    ThrustAcross,
    ThrustDip,
    CrustSutureStrength,
    CrustSuturePairIds,
    CrustProvinceSeam,
    SoilDepth,
    CumulativeDeposition,
}
const FIELD_COUNT: usize = GroundField::CumulativeDeposition as usize + 1;
impl GroundField {
    pub const ALL: [Self; FIELD_COUNT] = [
        Self::Elevation,
        Self::BedrockElevation,
        Self::CrustSupportElevation,
        Self::CrustSupportTarget,
        Self::SurfaceRockLoad,
        Self::CrustThickness,
        Self::CrustContinentalColumn,
        Self::CrustContinentalFraction,
        Self::CrustRootReserve,
        Self::SedimentThickness,
        Self::RockResistance,
        Self::RockKindCodes,
        Self::GroundCutShare,
        Self::GroundCutDepth,
        Self::GroundCutCover,
        Self::StructuralGrainX,
        Self::StructuralGrainY,
        Self::ThrustPairIds,
        Self::ThrustSheetIndex,
        Self::ThrustSegmentIds,
        Self::ThrustAcross,
        Self::ThrustDip,
        Self::CrustSutureStrength,
        Self::CrustSuturePairIds,
        Self::CrustProvinceSeam,
        Self::SoilDepth,
        Self::CumulativeDeposition,
    ];
    pub fn name(self) -> &'static str {
        [
            "Elevation",
            "BedrockElevation",
            "CrustSupportElevation",
            "CrustSupportTarget",
            "SurfaceRockLoad",
            "CrustThickness",
            "CrustContinentalColumn",
            "CrustContinentalFraction",
            "CrustRootReserve",
            "SedimentThickness",
            "RockResistance",
            "RockKindCodes",
            "GroundCutShare",
            "GroundCutDepth",
            "GroundCutCover",
            "StructuralGrainX",
            "StructuralGrainY",
            "ThrustPairIds",
            "ThrustSheetIndex",
            "ThrustSegmentIds",
            "ThrustAcross",
            "ThrustDip",
            "CrustSutureStrength",
            "CrustSuturePairIds",
            "CrustProvinceSeam",
            "SoilDepth",
            "CumulativeDeposition",
        ][self as usize]
    }
}
/// Construction transfers the bands into Ground; no writable projection is published afterward.
pub struct GroundStorage {
    pub(super) bands: [Band<f64>; FIELD_COUNT],
}
impl GroundStorage {
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            bands: std::array::from_fn(|_| coverage.allocate(0.0)),
        }
    }
    pub fn initialize(
        &mut self,
        field: GroundField,
        cell: usize,
        value: f64,
    ) -> std::io::Result<()> {
        self.bands[field as usize].set(cell, value)
    }
    pub fn view(&self, field: GroundField) -> ReadBand<f64> {
        self.bands[field as usize].read_only()
    }
}
