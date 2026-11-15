//! Explicit time and work bindings shared by map and physical process invocation.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Invocation {
    pub world_seed: i32,
    pub epoch_index: i32,
    pub step_salt: i32,
    pub epoch_duration: Option<f64>,
    pub exposure: f64,
}
impl Default for Invocation {
    fn default() -> Self {
        Self {
            world_seed: 0,
            epoch_index: -1,
            step_salt: 0,
            epoch_duration: None,
            exposure: 1.0,
        }
    }
}
impl Invocation {
    pub fn seeds(self) -> PhysicalSeeds {
        physical_seeds(self.world_seed, self.step_salt, self.epoch_index)
    }
    pub fn duration(self, binding: DurationBinding) -> Result<f64, &'static str> {
        binding.years(self.epoch_duration)
    }
    pub fn work(self) -> Result<f64, &'static str> {
        work_exposure(self.exposure)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PhysicalSeeds {
    pub seed: i32,
    pub epoch_stable_seed: i32,
}
/// The process's salt owns its spatial pattern; the epoch adds the current occurrence.
pub fn physical_seeds(seed: i32, salt: i32, epoch_index: i32) -> PhysicalSeeds {
    let epoch_stable_seed = seed ^ salt;
    let occurrence = if epoch_index < 0 {
        0
    } else {
        epoch_index.wrapping_add(1).wrapping_mul(0x045d_9f3b)
    };
    PhysicalSeeds {
        seed: epoch_stable_seed ^ occurrence,
        epoch_stable_seed,
    }
}
#[derive(Clone, Copy, Debug)]
pub enum DurationBinding {
    Years(f64),
    EpochFraction(f64),
}
impl DurationBinding {
    pub fn years(self, epoch_duration: Option<f64>) -> Result<f64, &'static str> {
        let value = match self {
            Self::Years(years) => years,
            Self::EpochFraction(fraction) => {
                epoch_duration.ok_or("Elapsed evolution requires the selected epoch duration")?
                    * fraction
            }
        };
        nonnegative(
            value,
            "Elapsed evolution needs a finite nonnegative duration",
        )
    }
}
pub fn work_exposure(value: f64) -> Result<f64, &'static str> {
    nonnegative(value, "Work exposure must be finite and nonnegative")
}
fn nonnegative(value: f64, message: &'static str) -> Result<f64, &'static str> {
    if value.is_finite() && value >= 0.0 {
        Ok(value)
    } else {
        Err(message)
    }
}
