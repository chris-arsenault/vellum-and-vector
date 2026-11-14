#[derive(Clone, Copy)]
pub struct Facts {
    pub years: f64,
    pub mobility: f64,
    pub sweeps: usize,
    pub range: f64,
    pub farms: bool,
    pub builds: bool,
    pub learns: bool,
    pub grows: bool,
}
impl Facts {
    pub fn loose(years: f64) -> Self {
        Self {
            years,
            mobility: 0.05,
            sweeps: 1,
            range: 0.005,
            farms: false,
            builds: false,
            learns: true,
            grows: true,
        }
    }
    pub fn settled(years: f64, mobility: f64) -> Self {
        Self {
            years,
            mobility: (0.25 * mobility.max(0.0)).min(0.6),
            sweeps: 3,
            range: 0.03,
            farms: true,
            builds: true,
            learns: true,
            grows: true,
        }
    }
    pub fn kept(years: f64) -> Self {
        Self {
            grows: false,
            ..Self::settled(years, 1.0)
        }
    }
}
pub fn passes_for(years: f64) -> usize {
    (years / 100.0).ceil().clamp(2.0, 6.0) as usize
}
pub const GROWTH_RATE: f64 = 0.02;
pub const HUNGER_YEARS: f64 = 30.0;
pub const PRESSURE: f64 = 0.25;
pub const MARKET_SHARE: f64 = 0.2;
pub const CLEARING_YEARS: f64 = 50.0;
pub const PEOPLE_PER_BUILT_KM2: f64 = 8000.0;
pub const BUILDING_YEARS: f64 = 50.0;
pub const WORKS_YEARS: f64 = 300.0;
pub const FOUNDERS: f64 = 0.3;
