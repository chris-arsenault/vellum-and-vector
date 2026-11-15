//! Non-owner physical channels. Ground, water and people allocate their own packages.
use crate::storage::{Band, Coverage, ReadBand};
use std::cell::{RefCell, RefMut};

macro_rules! fields {
    ($name:ident, $sample:ty, $($field:ident = $initial:expr),+ $(,)?) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
        #[repr(usize)]
        pub enum $name { $($field),+ }
        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$field),+];
            pub fn name(self) -> &'static str { match self { $(Self::$field => stringify!($field)),+ } }
            pub fn initial(self) -> $sample { match self { $(Self::$field => $initial),+ } }
            pub fn named(name: &str) -> Option<Self> { match name { $(stringify!($field) => Some(Self::$field),)+ _ => None } }
        }
    };
}
fields!(
    CellCode,
    i32,
    BiomeCodes = 0,
    CrustAssemblyIds = 0,
    CrustPlateIds = 0,
    CrustProvinceIds = 0,
    CrustTypeCodes = 0,
    AdvectionSourceIndex = 0,
    MarginCodes = 0,
    CoastalMarginCodes = 0,
    UpwindTargets = -1,
    UpwindOceanSources = -1,
    TectonicBoundaryCodes = 0,
    InitialTectonicBoundaryCodes = 0,
    TectonicBoundaryPairIds = 0,
    OrogenicComponentIds = -1,
    VolcanicLastActiveEpoch = -1,
    LandformCodes = 0,
    FeatureFlags = 0,
    LandmassIds = 0,
    LandmassClassCodes = 0,
    ContinentalGroupIds = 0,
    BathymetricZoneCodes = 0,
    IceFlowTargets = -1,
);
// Continuous physical values use f64; categorical identities and graph addresses remain integers.
// Native units remain unchanged. Representation precision is not a separate generation model.
fields!(
    Scalar,
    f64,
    CrustBasePotential = 0.0,
    CrustAssemblySeparation = 0.0,
    CrustCollisionIntensity = 0.0,
    CrustMotionX = 0.0,
    CrustMotionY = 0.0,
    CrustAge = 0.0,
    ContinentalPotential = 0.0,
    Temperature = 0.0,
    WindX = 0.0,
    WindY = 0.0,
    MoistureBarriers = 0.0,
    PrecipitationBarriers = 0.0,
    TectonicStrain = 0.0,
    InitialTectonicStrain = 0.0,
    TectonicTangentX = 0.0,
    TectonicTangentY = 0.0,
    OceanCurrentX = 0.0,
    OceanCurrentY = 0.0,
    OceanCurrentStrength = 0.0,
    OceanCurrentHeat = 0.0,
    SeaSurfaceAnomaly = 0.0,
    Upwelling = 0.0,
    WaveExposure = 0.0,
    SeaIceSuitability = 0.0,
    TectonicActivityHistory = 0.0,
    WaveExposureHistory = 0.0,
    GeothermalHistory = 0.0,
    ImpactHeat = 0.0,
    ExternalHeatForcing = 0.0,
    ExternalCoastalForcing = 0.0,
    ExternalCoastalForcingHistory = 0.0,
    Moisture = 0.0,
    Geothermal = 0.0,
    MantlePlumeRootStrength = 0.0,
    VolcanicActivity = 0.0,
    FloodplainIntensity = 0.0,
    DeltaIntensity = 0.0,
    IceBalance = 0.0,
    FractureConductance = 0.0,
    HeatSourceDensity = 0.0,
    Warmth = 0.0,
    CumulativeFluvialErosion = 0.0,
    CumulativeGlacialErosion = 0.0,
    CumulativeGlacialDeposition = 0.0,
    CumulativeCoastalErosion = 0.0,
    OrogenicConstruction = 0.0,
    ConvergentCrustSurplus = 0.0,
    OceanicSubduction = 0.0,
    OceanicSubductionHistory = 0.0,
    ImpactExcavation = 0.0,
    ImpactRimUplift = 0.0,
    ImpactEjectaThickness = 0.0,
    VolcanicConstructionHistory = 0.0,
    VolcanicMeltSupply = 0.0,
    LandmarkMaintenance = 0.0,
    Slope = 0.0,
    TreeCover = 0.0,
    GrassCover = 0.0,
    WetlandCover = 0.0,
    FireActivity = 0.0,
    BroadleafCover = 0.0,
    ConiferCover = 0.0,
    BroadleafSaplings = 0.0,
    ConiferSaplings = 0.0,
    GrassSeed = 0.0,
    BroadleafSeed = 0.0,
    ConiferSeed = 0.0,
    WetlandSeed = 0.0,
    EcologicalDamage = 0.0,
    EcologicalToxicity = 0.0,
    Infiltration = 0.0,
    SoilCarbon = 0.0,
    PeatCarbon = 0.0,
    AquaticCarbon = 0.0,
    BuriedPlantCarbon = 0.0,
    BuriedAquaticCarbon = 0.0,
    CoalCarbon = 0.0,
    OilCarbon = 0.0,
    GasCarbon = 0.0,
    EcologySediment = 0.0,
    EcologyVolcanic = 0.0,
    EcologyImpact = 0.0,
    EcologyErosion = 0.0,
    EcologyIce = 0.0,
    Grazers = 0.0,
    Browsers = 0.0,
    MineralNutrients = 0.0,
    CanopyAge = 0.0,
    MigrationFlux = 0.0,
    FloodFrequency = 0.0,
    Evapotranspiration = 0.0,
    Productivity = 0.0,
    AquaticProductivity = 0.0,
    Herbivores = 0.0,
    Predators = 0.0,
    AquaticFauna = 0.0,
    OrganicBurialDepth = 0.0,
    OrganicMaturity = 0.0,
    EcologyStillness = 0.0,
    OceanMarginDistance = -1.0,
    CrustRiftStrain = 0.0,
    CrustRiftAgeMyr = 0.0,
    OceanDistance = -1.0,
    Seasonality = 0.0,
    AirDemand = 0.0,
    WindSpeed = 0.0,
    Rainfall = 0.0,
    Snowfall = 0.0,
    OrganicBurialInput = 0.0,
    OrganicBurialThickness = 0.0,
    ColumnPrecipitation = 0.0,
    IceFlux = 0.0,
    MaximumIceFlux = 0.0,
    MaximumGroundedIceFlux = 0.0,
    IceThickness = 0.0,
    IceRetreat = 0.0,
    MaximumIceThickness = 0.0,
    Quickening = 0.0,
    Stillness = 0.0,
    IcePersistence = 0.0,
    IceCharge = 0.0,
    ExternalUpwelling = 0.0,
    ExternalSeaSurfaceForcing = 0.0,
    FogForcing = 0.0,
    StormForcing = 0.0,
    StormTrack = 0.0,
    FirstEpochHeight = 0.0,
    Verdure = 0.0,
    Salting = 0.0,
    Warding = 0.0,
    Tearing = 0.0,
);
fields!(FloatField, f32, RidgeInfluence = 0.0, Uplift = 0.0);
fields!(Flag, u8, GroundedIce = 0);

pub struct SharedFields {
    scalars: [RefCell<Band<f64>>; Scalar::ALL.len()],
    codes: [RefCell<Band<i32>>; CellCode::ALL.len()],
    floats: [RefCell<Band<f32>>; FloatField::ALL.len()],
    flags: [Band<u8>; Flag::ALL.len()],
}
impl SharedFields {
    pub(super) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> std::io::Result<()> {
        archive.label("shared-fields")?;
        for field in Scalar::ALL {
            archive.band(field.name(), self.scalar_mut(*field))?;
        }
        for field in CellCode::ALL {
            archive.band(field.name(), self.code_mut(*field))?;
        }
        for field in FloatField::ALL {
            archive.band(field.name(), self.float_mut(*field))?;
        }
        for field in Flag::ALL {
            archive.band(field.name(), self.flag_mut(*field))?;
        }
        Ok(())
    }
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            scalars: std::array::from_fn(|at| {
                RefCell::new(coverage.allocate(Scalar::ALL[at].initial()))
            }),
            codes: std::array::from_fn(|at| {
                RefCell::new(coverage.allocate(CellCode::ALL[at].initial()))
            }),
            floats: std::array::from_fn(|at| {
                RefCell::new(coverage.allocate(FloatField::ALL[at].initial()))
            }),
            flags: std::array::from_fn(|at| coverage.allocate(Flag::ALL[at].initial())),
        }
    }
    pub fn scalar(&self, field: Scalar) -> ReadBand<f64> {
        self.scalars[field as usize].borrow().read_only()
    }
    pub fn code(&self, field: CellCode) -> ReadBand<i32> {
        self.codes[field as usize].borrow().read_only()
    }
    pub fn float(&self, field: FloatField) -> ReadBand<f32> {
        self.floats[field as usize].borrow().read_only()
    }
    pub fn flag(&self, field: Flag) -> ReadBand<u8> {
        self.flags[field as usize].read_only()
    }
    pub fn scalar_mut(&mut self, field: Scalar) -> &mut Band<f64> {
        self.scalars[field as usize].get_mut()
    }
    pub fn code_mut(&mut self, field: CellCode) -> &mut Band<i32> {
        self.codes[field as usize].get_mut()
    }
    pub fn float_mut(&mut self, field: FloatField) -> &mut Band<f32> {
        self.floats[field as usize].get_mut()
    }
    pub fn flag_mut(&mut self, field: Flag) -> &mut Band<u8> {
        &mut self.flags[field as usize]
    }
    // Only field-owned derived queries can refresh canonical derived channels through a read.
    pub(super) fn derive_scalar(&self, field: Scalar) -> RefMut<'_, Band<f64>> {
        self.scalars[field as usize].borrow_mut()
    }
    pub(super) fn derive_code(&self, field: CellCode) -> RefMut<'_, Band<i32>> {
        self.codes[field as usize].borrow_mut()
    }
    pub(super) fn derive_float(&self, field: FloatField) -> RefMut<'_, Band<f32>> {
        self.floats[field as usize].borrow_mut()
    }
}
