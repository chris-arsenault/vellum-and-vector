use super::land::mix;
use crate::{
    field::{shared::Scalar as S, Field},
    human::catalogue::{self, CompiledLayerMix, LayerMode},
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale, RelativeMeasure},
};
use std::io;

#[derive(Clone, Copy)]
pub enum Hazard {
    Avalanche,
    Flood,
    Tsunami,
}
impl Hazard {
    pub const ALL: [Self; 3] = [Self::Avalanche, Self::Flood, Self::Tsunami];
    pub fn kind(self) -> &'static str {
        match self {
            Self::Avalanche => "avalanche",
            Self::Flood => "flood",
            Self::Tsunami => "tsunami",
        }
    }
    pub fn severity(self) -> f64 {
        match self {
            Self::Avalanche => 0.5,
            Self::Flood => 0.12,
            Self::Tsunami => 0.4,
        }
    }
    pub fn cause(self) -> &'static str {
        match self {
            Self::Avalanche => "Snow-bearing steep ground let go above the place.",
            Self::Flood => "The river rose over the ground the place stands on.",
            Self::Tsunami => "A straining coast threw the sea over the low shore.",
        }
    }
    pub fn mix(self) -> CompiledLayerMix {
        match self {
            Self::Avalanche => mix(LayerMode::Scour),
            Self::Flood => mix(LayerMode::Drown),
            Self::Tsunami => {
                let mut modes = [0.0; 7];
                modes[LayerMode::Drown as usize] = 0.7;
                modes[LayerMode::Shake as usize] = 0.3;
                catalogue::compile(modes)
            }
        }
    }
    pub fn yearly(self, field: &Field, cell: usize) -> io::Result<f64> {
        let read = |name| field.shared.scalar(name).get(cell);
        match self {
            Self::Avalanche => Ok(
                if read(S::Slope)? > 0.15
                    && read(S::IceThickness)? > length(field, 0.00000025, 0.5)?
                {
                    0.002
                } else {
                    0.0
                },
            ),
            Self::Flood => Ok(read(S::FloodFrequency)? * 0.02),
            Self::Tsunami => {
                let height = field.ground().view(GroundField::Elevation).get(cell)?
                    - field.water().effective_sea_level;
                let shore = read(S::OceanDistance)?;
                Ok(
                    if height < MapScale::native(length(field, 0.000005, 0.5)?)
                        && shore >= 0.0
                        && shore < length(field, 0.0025, 1.0)?
                    {
                        read(S::TectonicStrain)? / 1000.0 * 0.00001
                    } else {
                        0.0
                    },
                )
            }
        }
    }
}
fn length(field: &Field, fraction: f64, exponent: f64) -> io::Result<f64> {
    Ok(field
        .scale
        .resolve(
            RelativeMeasure::new(fraction, 1.0, exponent, LengthUnit::Metre)
                .map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?
        .value())
}
