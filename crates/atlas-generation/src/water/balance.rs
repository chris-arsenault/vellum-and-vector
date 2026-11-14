//! Monthly stocks and seasonal fluxes from the completed water/waterBalance.ts.
use super::stores::WaterStore;
use std::f64::consts::PI;
pub const MONTHS: usize = 12;
pub fn monthly_warmth(mean: f64, half_range: f64) -> [f64; MONTHS] {
    std::array::from_fn(|month| mean + half_range.max(0.0) * sun_standing(month))
}
pub fn sun_standing(month: usize) -> f64 {
    -(2.0 * PI * month as f64 / MONTHS as f64).cos()
}
pub fn evaporated_share(demand: f64, supply: f64) -> f64 {
    if supply <= 0.0 {
        return 0.0;
    }
    let aridity = demand.max(0.0) / supply;
    if aridity == 0.0 {
        return 0.0;
    }
    (aridity * (1.0 / aridity).tanh() * (1.0 - (-aridity).exp()))
        .sqrt()
        .min(1.0)
}
pub fn air_demand(celsius: f64, daylight: f64) -> f64 {
    if celsius <= 0.0 {
        return 0.0;
    }
    let vapour = 4.95 * (0.062 * celsius).exp() / 100.0;
    13.97 * (365.25 / MONTHS as f64) * daylight * daylight * vapour
}
pub fn day_length(latitude: f64, declination: f64) -> f64 {
    let x = -latitude.abs().to_radians().tan() * declination.to_radians().tan();
    if x >= 1.0 {
        0.0
    } else if x <= -1.0 {
        2.0
    } else {
        2.0 * x.acos() / PI
    }
}
pub struct WaterGround {
    pub rain: [f64; MONTHS],
    pub snow: [f64; MONTHS],
    pub demand: [f64; MONTHS],
    pub melt: [f64; MONTHS],
    pub soil_capacity: f64,
    pub sinking: f64,
    pub storm_share: f64,
}
#[derive(Default)]
pub struct HeldWater {
    pub soil: Option<f64>,
    pub snow: Option<f64>,
}
#[derive(Default)]
pub struct WaterYear {
    pub quick: [f64; MONTHS],
    pub thaw: [f64; MONTHS],
    pub recharge: f64,
    pub evaporated: f64,
    pub kept_snow: f64,
    pub soil: f64,
    pub snow: f64,
    pub end_soil: f64,
    pub end_snow: f64,
}
pub fn evaporated(demand: f64, wetting: f64, soil: f64, capacity: f64) -> f64 {
    let met = demand.min(wetting);
    let lack = demand - met;
    if lack <= 0.0 || soil <= 0.0 {
        return met;
    }
    met + if capacity > 0.0 {
        soil * -(-lack / capacity).exp_m1()
    } else {
        soil
    }
}
struct Stores {
    soil: WaterStore,
    snow: WaterStore,
}
struct Month {
    quick: f64,
    thaw: f64,
    recharge: f64,
    evaporated: f64,
}
fn month(ground: &WaterGround, at: usize, stores: &mut Stores) -> Month {
    stores.snow.receive(ground.snow[at]);
    let thaw = stores.snow.give(ground.melt[at]);
    let storm = ground.rain[at] * ground.storm_share;
    let wetting = ground.rain[at] - storm + thaw;
    let met = ground.demand[at].max(0.0).min(wetting);
    let taken = met + stores.soil.give(ground.demand[at].max(0.0) - met);
    let shed = stores.soil.drain_excess() + stores.soil.receive(wetting - met);
    let sinking = shed * ground.sinking;
    Month {
        quick: storm + shed - sinking,
        thaw,
        recharge: sinking,
        evaporated: taken,
    }
}
pub fn water_year(ground: &WaterGround, held: HeldWater) -> WaterYear {
    let mut stores = Stores {
        soil: WaterStore {
            held: 0.0,
            capacity: ground.soil_capacity,
            retention: ground.soil_capacity,
        },
        snow: WaterStore {
            held: 0.0,
            capacity: f64::INFINITY,
            retention: 0.0,
        },
    };
    let mut year = WaterYear::default();
    for pass in 0..3 {
        if pass == 2 {
            if let Some(soil) = held.soil {
                stores.soil.held = soil.max(0.0);
            }
            if let Some(snow) = held.snow {
                stores.snow.held = snow.max(0.0);
            }
        }
        year = seasonal_year(ground, &mut stores);
    }
    year
}
fn seasonal_year(ground: &WaterGround, stores: &mut Stores) -> WaterYear {
    let before = stores.snow.held;
    let mut least = f64::INFINITY;
    let mut year = WaterYear::default();
    for at in 0..MONTHS {
        let shed = month(ground, at, stores);
        year.quick[at] = shed.quick;
        year.thaw[at] = shed.thaw;
        year.recharge += shed.recharge;
        year.evaporated += shed.evaporated;
        year.soil += stores.soil.held / MONTHS as f64;
        year.snow += stores.snow.held / MONTHS as f64;
        least = least.min(stores.snow.held);
    }
    year.snow -= least;
    year.kept_snow = if least > 0.0 {
        (stores.snow.held - before).max(0.0)
    } else {
        0.0
    };
    stores.snow.give(year.kept_snow);
    year.end_soil = stores.soil.held;
    year.end_snow = stores.snow.held;
    year
}
pub struct AnnualFlow {
    pub perennial: f64,
    pub flood: f64,
    pub mean: f64,
    pub flowing: usize,
}
pub fn flow_through_year(monthly: &[f64], river: f64) -> AnnualFlow {
    let mut result = AnnualFlow {
        perennial: f64::INFINITY,
        flood: 0.0,
        mean: 0.0,
        flowing: 0,
    };
    for &flow in monthly {
        result.perennial = result.perennial.min(flow);
        result.flood = result.flood.max(flow);
        result.mean += flow;
        if river > 0.0 && flow >= river {
            result.flowing += 1;
        }
    }
    if monthly.is_empty() {
        result.perennial = 0.0;
    } else {
        result.mean /= monthly.len() as f64;
    }
    result
}
