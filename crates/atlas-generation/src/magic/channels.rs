//! Lifetime and quantity declarations from magicFieldDefinitions.ts.
use crate::storage::{Band, Coverage, ReadBand};
#[derive(Clone, Copy)]
pub enum Quantity {
    Intensive,
    Extensive,
    Category,
}
#[derive(Clone, Copy)]
pub struct Definition {
    pub name: &'static str,
    pub unit: &'static str,
    pub quantity: Quantity,
    pub initial: f64,
    pub carried: bool,
    pub publish: bool,
}
macro_rules! channels {
    ($($name:ident => ($wire:expr, $unit:expr, $quantity:ident, $initial:expr, $carried:expr, $publish:expr)),+ $(,)?) => {
        #[derive(Clone, Copy)]
        #[repr(usize)]
        pub enum Channel { $($name,)+ }
        impl Channel {
            pub const ALL: &'static [Self] = &[$(Self::$name,)+];
            pub fn definition(self) -> Definition {
                match self { $(Self::$name => Definition { name: $wire, unit: $unit,
                    quantity: Quantity::$quantity, initial: $initial, carried: $carried, publish: $publish },)+ }
            }
        }
    }
}
channels! {
    Intensity => ("intensity", "relative-intensity", Intensive, 0.0, false, true),
    History => ("history", "relative-intensity", Intensive, 0.0, true, true),
    FirstEpoch => ("firstEpoch", "category", Category, -1.0, true, true),
    Stored => ("stored", "relative-intensity", Intensive, 0.0, true, true),
    Retained => ("retained", "intensity-square-metre", Extensive, 0.0, false, true),
    CoastalHistory => ("coastalHistory", "relative-intensity", Intensive, 0.0, true, true),
    CoastalFirstEpoch => ("coastalFirstEpoch", "category", Category, -1.0, true, true),
    Source => ("source", "relative-intensity", Intensive, 0.0, false, true),
    Wake => ("wake", "relative-intensity", Intensive, 0.0, false, true),
    Rogue => ("rogue", "relative-intensity", Intensive, 0.0, false, true),
    Sealed => ("sealed", "category", Category, 0.0, true, true),
    Arrival => ("arrival", "category", Category, -1.0, true, true),
    Releasing => ("releasing", "ratio", Intensive, 0.0, false, false),
    Subsided => ("subsided", "metre", Intensive, 0.0, true, true),
    Domed => ("domed", "metre", Intensive, 0.0, true, true),
    Wild => ("wild", "ratio", Intensive, 0.0, false, true),
    Radii => ("radii", "metre", Intensive, 0.0, false, false),
}
pub struct Channels {
    bands: Vec<Band<f64>>,
}
impl Channels {
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            bands: Channel::ALL
                .iter()
                .map(|c| coverage.allocate(c.definition().initial))
                .collect(),
        }
    }
    pub fn view(&self, channel: Channel) -> ReadBand<f64> {
        self.bands[channel as usize].read_only()
    }
    pub(super) fn band(&self, channel: Channel) -> &Band<f64> {
        &self.bands[channel as usize]
    }
    pub(super) fn band_mut(&mut self, channel: Channel) -> &mut Band<f64> {
        &mut self.bands[channel as usize]
    }
    pub(super) fn replace(&mut self, channel: Channel, band: Band<f64>) -> Band<f64> {
        std::mem::replace(&mut self.bands[channel as usize], band)
    }
}
