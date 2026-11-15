//! The typical year's stated transfers. Recomputing a move replaces its reported amount.
use crate::scale::{LengthUnit, MapScale};
pub const SECONDS_PER_YEAR: f64 = 365.25 * 24.0 * 3600.0;
pub fn depth_rate_to_discharge(millimetres: f64, area: f64) -> f64 {
    MapScale::metres(millimetres, LengthUnit::Millimetre) * area / SECONDS_PER_YEAR
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub enum Store {
    Air,
    Snow,
    Ice,
    Soil,
    Ground,
    River,
    Lake,
    Sea,
    People,
    Beyond,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub enum Move {
    Rain,
    Snowfall,
    Thaw,
    Firn,
    IceMelt,
    MeltOfKeptSnow,
    MeltFromOutside,
    Calving,
    Sublimation,
    Evaporation,
    Runoff,
    Recharge,
    Spring,
    SeepToSea,
    BedLoss,
    Withdrawal,
    Inflow,
    LakeEvaporation,
    LakeSeepage,
    Spill,
    Mouth,
    Entering,
    Leaving,
    Pan,
}
const MOVES: [Move; 24] = [
    Move::Rain,
    Move::Snowfall,
    Move::Thaw,
    Move::Firn,
    Move::IceMelt,
    Move::MeltOfKeptSnow,
    Move::MeltFromOutside,
    Move::Calving,
    Move::Sublimation,
    Move::Evaporation,
    Move::Runoff,
    Move::Recharge,
    Move::Spring,
    Move::SeepToSea,
    Move::BedLoss,
    Move::Withdrawal,
    Move::Inflow,
    Move::LakeEvaporation,
    Move::LakeSeepage,
    Move::Spill,
    Move::Mouth,
    Move::Entering,
    Move::Leaving,
    Move::Pan,
];
impl Move {
    pub fn name(self) -> &'static str {
        [
            "rain",
            "snowfall",
            "thaw",
            "firn",
            "iceMelt",
            "meltOfKeptSnow",
            "meltFromOutside",
            "calving",
            "sublimation",
            "evaporation",
            "runoff",
            "recharge",
            "spring",
            "seepToSea",
            "bedLoss",
            "withdrawal",
            "inflow",
            "lakeEvaporation",
            "lakeSeepage",
            "spill",
            "mouth",
            "entering",
            "leaving",
            "pan",
        ][self as usize]
    }
    pub fn stores(self) -> (Store, Store) {
        use Store::*;
        match self {
            Self::Rain => (Air, Soil),
            Self::Snowfall => (Air, Snow),
            Self::Thaw => (Snow, Soil),
            Self::Firn => (Snow, Ice),
            Self::IceMelt => (Ice, River),
            Self::MeltOfKeptSnow | Self::MeltFromOutside => (Ice, Ice),
            Self::Calving => (Ice, Sea),
            Self::Sublimation => (Ice, Air),
            Self::Evaporation => (Soil, Air),
            Self::Runoff => (Soil, River),
            Self::Recharge => (Soil, Ground),
            Self::Spring => (Ground, River),
            Self::SeepToSea => (Ground, Sea),
            Self::BedLoss => (River, Ground),
            Self::Withdrawal => (River, People),
            Self::Inflow => (River, Lake),
            Self::LakeEvaporation => (Lake, Air),
            Self::LakeSeepage => (Lake, Ground),
            Self::Spill => (Lake, River),
            Self::Mouth => (River, Sea),
            Self::Entering => (Beyond, River),
            Self::Leaving => (River, Beyond),
            Self::Pan => (River, Air),
        }
    }
}
#[derive(Default)]
pub struct WaterLedger {
    volumes: [f64; 24],
}
pub struct Transfer {
    pub cause: Move,
    pub from: Store,
    pub to: Store,
    pub volume: f64,
}
impl WaterLedger {
    pub(super) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> std::io::Result<()> {
        archive.value("water-ledger", &mut self.volumes)
    }
    /// Existing progress text observes transfers; it does not validate or constrain the solver.
    pub fn account_line(&self) -> String {
        let moves = self.transfers();
        let fell: f64 = moves
            .iter()
            .filter(|movement| movement.from == Store::Air)
            .map(|movement| movement.volume)
            .sum();
        if fell <= 0.0 {
            return "no water fell".into();
        }
        let stores = [
            "air", "snow", "ice", "soil", "ground", "river", "lake", "sea", "people", "beyond",
        ];
        let mut net = [0.0; 10];
        let share = |volume| format!("{:.1}%", 100.0 * volume / fell);
        let descriptions = moves
            .iter()
            .map(|movement| {
                net[movement.from as usize] -= movement.volume;
                net[movement.to as usize] += movement.volume;
                format!(
                    "{} {} to {} {}",
                    movement.cause.name(),
                    stores[movement.from as usize],
                    stores[movement.to as usize],
                    share(movement.volume)
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        format!("of the {:.1} cubic km that falls in a year: {descriptions}; left over in rivers {}, in lakes {}, in soil {}, gained by the ground {}",
            fell / 1e9, share(net[Store::River as usize]), share(net[Store::Lake as usize]), share(net[Store::Soil as usize]), share(net[Store::Ground as usize]))
    }
    pub fn state(&mut self, move_: Move, volume: f64) {
        self.volumes[move_ as usize] = if volume > 0.0 { volume } else { 0.0 };
    }
    pub fn flow(&mut self, move_: Move, flow: f64) {
        self.state(move_, flow * SECONDS_PER_YEAR);
    }
    pub fn depth(&mut self, move_: Move, millimetres: f64, area: f64) {
        self.state(
            move_,
            MapScale::metres(millimetres, LengthUnit::Millimetre) * area,
        );
    }
    pub fn volume(&self, move_: Move) -> f64 {
        self.volumes[move_ as usize]
    }
    pub fn transfers(&self) -> Vec<Transfer> {
        let mut transfers: Vec<_> = MOVES
            .iter()
            .filter_map(|&cause| {
                let volume = self.volume(cause);
                let (from, to) = cause.stores();
                (volume != 0.0).then_some(Transfer {
                    cause,
                    from,
                    to,
                    volume,
                })
            })
            .collect();
        // hpc-exempt: the 24 water-account transfer categories, not numerical cell state
        transfers.sort_by(|a, b| b.volume.total_cmp(&a.volume));
        transfers
    }
}
