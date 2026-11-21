//! Current generation-resource names over owner read views. This is not the map schema.
use super::{
    shared::{CellCode, Flag, FloatField, Scalar},
    Field,
};
use crate::{
    human::{catalogue::LayerId, identity::IDENTITY_SLOTS, HumanField},
    rock::{
        columns::Column,
        ground::GroundField,
        layer_bands::{MaterialScalar, ReadLayerBands},
    },
    storage::{ReadBand, ReadValues},
    transport::quantities::QuantityKind,
    water::{column::Store, WaterView},
};
use std::io;

#[derive(Clone)]
pub enum NumericBand {
    F64(ReadBand<f64>),
    F32(ReadBand<f32>),
    I32(ReadBand<i32>),
    U32(ReadBand<u32>),
    U8(ReadBand<u8>),
    I8(ReadBand<i8>),
}
pub enum NumericValues<'a> {
    F64(ReadValues<'a, f64>),
    F32(ReadValues<'a, f32>),
    I32(ReadValues<'a, i32>),
    U32(ReadValues<'a, u32>),
    U8(ReadValues<'a, u8>),
    I8(ReadValues<'a, i8>),
}
impl NumericValues<'_> {
    pub fn get(&self, cell: usize) -> io::Result<f64> {
        match self {
            Self::F64(v) => v.get(cell),
            Self::F32(v) => v.get(cell).map(f64::from),
            Self::I32(v) => v.get(cell).map(f64::from),
            Self::U32(v) => v.get(cell).map(f64::from),
            Self::U8(v) => v.get(cell).map(f64::from),
            Self::I8(v) => v.get(cell).map(f64::from),
        }
    }
}
impl NumericBand {
    pub fn read_values(&self) -> io::Result<NumericValues<'_>> {
        Ok(match self {
            Self::F64(v) => NumericValues::F64(v.read_values()?),
            Self::F32(v) => NumericValues::F32(v.read_values()?),
            Self::I32(v) => NumericValues::I32(v.read_values()?),
            Self::U32(v) => NumericValues::U32(v.read_values()?),
            Self::U8(v) => NumericValues::U8(v.read_values()?),
            Self::I8(v) => NumericValues::I8(v.read_values()?),
        })
    }
    pub fn sample_type(&self) -> &'static str {
        match self {
            Self::F64(_) => "float64",
            Self::F32(_) => "float32",
            Self::I32(_) => "int32",
            Self::U32(_) => "uint32",
            Self::U8(_) => "uint8",
            Self::I8(_) => "int8",
        }
    }
    pub fn len(&self) -> usize {
        match self {
            Self::F64(v) => v.len(),
            Self::F32(v) => v.len(),
            Self::I32(v) => v.len(),
            Self::U32(v) => v.len(),
            Self::U8(v) => v.len(),
            Self::I8(v) => v.len(),
        }
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    pub fn get(&self, cell: usize) -> io::Result<f64> {
        match self {
            Self::F64(v) => v.get(cell),
            Self::F32(v) => v.get(cell).map(f64::from),
            Self::I32(v) => v.get(cell).map(f64::from),
            Self::U32(v) => v.get(cell).map(f64::from),
            Self::U8(v) => v.get(cell).map(f64::from),
            Self::I8(v) => v.get(cell).map(f64::from),
        }
    }
}
macro_rules! conversion {
    ($sample:ty, $variant:ident) => {
        impl From<ReadBand<$sample>> for NumericBand {
            fn from(value: ReadBand<$sample>) -> Self {
                Self::$variant(value)
            }
        }
    };
}
conversion!(f64, F64);
conversion!(f32, F32);
conversion!(i32, I32);
conversion!(u32, U32);
conversion!(u8, U8);
conversion!(i8, I8);
pub struct NamedBand {
    pub name: String,
    pub values: NumericBand,
    pub quantity: QuantityKind,
}
fn add(bands: &mut Vec<NamedBand>, name: impl Into<String>, values: impl Into<NumericBand>) {
    bands.push(NamedBand {
        name: name.into(),
        values: values.into(),
        quantity: QuantityKind::Derived,
    });
}
impl Field {
    pub fn bands(&self) -> Vec<NamedBand> {
        let mut bands = Vec::new();
        for field in Scalar::ALL {
            add(&mut bands, field.name(), self.shared.scalar(*field));
            bands.last_mut().unwrap().quantity = field.quantity();
        }
        for field in CellCode::ALL {
            add(&mut bands, field.name(), self.shared.code(*field));
            bands.last_mut().unwrap().quantity = field.quantity();
        }
        for field in FloatField::ALL {
            add(&mut bands, field.name(), self.shared.float(*field));
        }
        for field in Flag::ALL {
            add(&mut bands, field.name(), self.shared.flag(*field));
        }
        let ground = self.ground.borrow();
        for field in GroundField::ALL {
            add(&mut bands, field.name(), ground.view(field));
            bands.last_mut().unwrap().quantity = field.quantity();
        }
        for (column, prefix) in [
            (Column::Land, "RockLayer"),
            (Column::Cut, "RockCutLayer"),
            (Column::Loose, "LooseLayer"),
            (Column::CutLoose, "LooseCutLayer"),
        ] {
            for slot in 0..column.size() {
                material(
                    &mut bands,
                    ground.columns().view(column, slot),
                    |property| format!("{prefix}{property}{slot}"),
                );
            }
        }
        for (load, prefix) in [
            (&self.ground_load, "GroundLoad"),
            (&self.sea_load, "SeaLoad"),
        ] {
            material(&mut bands, load.view(), |property| {
                format!(
                    "{prefix}{}",
                    if property == "Depth" {
                        "Volume"
                    } else {
                        property
                    }
                )
            });
        }
        add(
            &mut bands,
            "SedimentSupply",
            self.ground_load
                .supply()
                .expect("Ground load owns its supply projection"),
        );
        bands.last_mut().unwrap().quantity = QuantityKind::Ground;
        water(&mut bands, self.water());
        people(&mut bands, &self.people);
        bands
    }
}
fn material(bands: &mut Vec<NamedBand>, layer: ReadLayerBands, name: impl Fn(&str) -> String) {
    let start = bands.len();
    add(bands, name("Kind"), layer.kind());
    add(bands, name("SecondaryKind"), layer.secondary_kind());
    add(bands, name("Mixed"), layer.mixed());
    for scalar in MaterialScalar::ALL {
        add(bands, name(scalar.name()), layer.scalar(scalar));
    }
    for band in &mut bands[start..] {
        band.quantity = QuantityKind::Ground;
    }
}
fn people(bands: &mut Vec<NamedBand>, people: &crate::human::HumanLayers) {
    let start = bands.len();
    for (id, name) in
        LayerId::ALL
            .into_iter()
            .zip(["Population", "Farmland", "Pasture", "BuiltUp", "Standing"])
    {
        add(bands, name, people.view(HumanField::Layer(id)));
    }
    for (id, name) in [
        (HumanField::RuinedBuiltUp, "RuinedBuiltUp"),
        (HumanField::RuinedStanding, "RuinedStanding"),
        (HumanField::RuinCover, "RuinCover"),
        (HumanField::Tenure, "Tenure"),
        (HumanField::WalkedRoute, "WalkedRoute"),
        (HumanField::MassDeath, "MassDeath"),
        (HumanField::KeptLine, "KeptLine"),
    ] {
        add(bands, name, people.view(id));
    }
    add(bands, "RuinTongue", people.ruin_tongue());
    for slot in 0..IDENTITY_SLOTS {
        let identity = people.identity(slot);
        for (name, value) in [
            ("People", identity.people),
            ("Hardness", identity.hardness),
            ("Age", identity.age),
        ] {
            add(bands, format!("Identity{name}{slot}"), value);
        }
        for (name, value) in crate::human::identity::Tradition::NAMES
            .into_iter()
            .zip(identity.traditions)
        {
            add(bands, format!("Identity{name}{slot}"), value);
        }
    }
    for band in &mut bands[start..] {
        band.quantity = match band.name.as_str() {
            "Tenure" | "WalkedRoute" | "MassDeath" => QuantityKind::Amount,
            "KeptLine" => QuantityKind::Share,
            _ => QuantityKind::Carried,
        };
    }
}
fn water(bands: &mut Vec<NamedBand>, v: WaterView) {
    let start = bands.len();
    for (name, store) in [
        ("SnowPack", Store::Snow),
        ("SoilWater", Store::Soil),
        ("GroundwaterStorage", Store::Ground),
        ("WaterDepths", Store::Standing),
    ] {
        add(bands, name, v.column.store(store).contents());
    }
    for (name, value) in [
        ("WaterSurfaceElevations", v.column.surface),
        ("LakeOverflow", v.column.lake_overflow),
        ("LakeMemory", v.column.lake_memory),
        ("DrainageElevations", v.drainage.elevations),
        ("GroundwaterExchangeVolume", v.groundwater.exchange),
        ("GroundwaterRecharge", v.groundwater.recharge),
        ("GroundwaterOutflow", v.groundwater.outflow),
        ("GroundwaterReturn", v.groundwater.returned),
        ("ExternalMeltwater", v.melt.external),
        ("GlacialMeltwater", v.melt.glacial),
        ("Runoff", v.runoff.mean),
        ("FloodRunoff", v.runoff.flood),
        ("DryRunoff", v.runoff.dry),
        ("FlowAccumulation", v.flow.mean),
        ("FloodFlow", v.flow.flood),
        ("PerennialFlow", v.flow.perennial),
        ("CatchmentArea", v.flow.catchment),
        ("SeepageRecharge", v.flow.seepage),
        ("RiverWidth", v.channels.width),
        ("RiverDepth", v.channels.depth),
        ("RiverChannelStrength", v.channels.strength),
        ("SmallChannelLength", v.small_channel_length),
        ("RiverWarmth", v.warmth),
    ] {
        add(bands, name, value);
    }
    for (name, value) in [
        ("WaterBodyIds", v.column.body),
        ("LakeOutletTargets", v.column.lake_outlet),
        ("GroundwaterTargets", v.groundwater.targets),
        ("DrainageParents", v.drainage.parents),
        ("DrainageRanks", v.drainage.ranks),
        ("DrainageGuidanceTargets", v.drainage.guidance),
        ("FlowTargets", v.routing.targets),
        ("FlowEdges", v.routing.edges),
        ("DrainageBasinIds", v.routing.basins),
    ] {
        add(bands, name, value);
    }
    add(bands, "WaterKindCodes", v.column.kind);
    add(bands, "RiverOrders", v.river_orders);
    add(bands, "RiverChannelOrders", v.channels.orders);
    add(bands, "RiverSpineEdgeMasks", v.river_spines);
    add(bands, "FlowingMonths", v.flowing_months);
    for (month, value) in v.column.year.into_iter().enumerate() {
        let name = match month {
            12 => "WaterRecharge".into(),
            13 => "SnowKept".into(),
            _ => format!("SurfaceWaterMonth{month}"),
        };
        add(bands, name, value);
    }
    for band in &mut bands[start..] {
        band.quantity = match band.name.as_str() {
            "LakeMemory" | "RiverWarmth" => QuantityKind::Share,
            "SnowPack"
            | "SoilWater"
            | "GroundwaterStorage"
            | "WaterDepths"
            | "WaterSurfaceElevations"
            | "WaterKindCodes"
            | "WaterBodyIds"
            | "WaterRecharge"
            | "SnowKept" => QuantityKind::Carried,
            name if name.starts_with("SurfaceWaterMonth") => QuantityKind::Carried,
            _ => QuantityKind::Derived,
        };
    }
}
