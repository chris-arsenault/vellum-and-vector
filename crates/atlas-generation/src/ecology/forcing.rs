use super::{unit, Forcing, Habitat};
use crate::{
    atlas::{context::EcologyEpoch, parameters::AtlasParameters},
    field::shared::{Scalar as S, SharedFields},
    magic::{channels::Channel, feedback::held_charge_values, state::MagicField},
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::ReadBand,
};
use std::io;
struct Influence {
    intensity: ReadBand<f64>,
    stored: ReadBand<f64>,
    effects: [f64; 5],
    ice_persistence: f64,
    relict: f64,
}
pub struct Inputs {
    influences: Vec<Influence>,
    channels: [ReadBand<f64>; 5],
    skin: f64,
    base: Forcing,
}
impl Inputs {
    pub fn new(
        fields: &SharedFields,
        magic: &[MagicField],
        scale: &MapScale,
        parameters: &AtlasParameters,
        ecology: &EcologyEpoch,
    ) -> io::Result<Self> {
        let influences = magic
            .iter()
            .filter(|field| field.definition().enabled)
            .map(|field| {
                let definition = field.definition();
                let e = &definition.effects;
                Influence {
                    intensity: field.channel(Channel::Intensity),
                    stored: field.channel(Channel::Stored),
                    effects: [
                        e.vegetation_growth,
                        e.fire,
                        e.organic_preservation,
                        e.animal_toxicity,
                        e.seed_dispersal,
                    ],
                    ice_persistence: e.ice_persistence,
                    relict: definition.parameters.relict_strength,
                }
            })
            .collect();
        Ok(Self {
            influences,
            channels: [
                S::Quickening,
                S::Stillness,
                S::Verdure,
                S::Salting,
                S::IceThickness,
            ]
            .map(|name| fields.scalar(name)),
            skin: scale
                .resolve(
                    RelativeMeasure::new(0.0000125, 1, 0.5, LengthUnit::Metre)
                        .map_err(io::Error::other)?,
                )
                .map_err(io::Error::other)?
                .value(),
            base: Forcing {
                productivity: parameters.vegetation * ecology.productivity,
                grazing: parameters.grazing,
                seasonality: ecology.seasonality,
                migration: ecology.migration,
                recovery: ecology.recovery,
                fire_regime: ecology.fire,
                ..Forcing::default()
            },
        })
    }
    pub fn at(&self, cell: usize) -> io::Result<Forcing> {
        let mut effects = [0.0; 5];
        for field in &self.influences {
            let intensity = field.intensity.get(cell)?;
            let held = if field.ice_persistence == 0.0 {
                1.0
            } else {
                held_charge_values(
                    field.stored.get(cell)?,
                    intensity,
                    self.channels[4].get(cell)?,
                    self.skin,
                    field.relict,
                )
            };
            for (sum, effect) in effects.iter_mut().zip(field.effects) {
                *sum += intensity / 1000.0 * held * effect;
            }
        }
        Ok(Forcing {
            growth: effects[0],
            fire: effects[1],
            preservation: effects[2],
            toxicity: effects[3],
            dispersal: effects[4],
            quickening: self.channels[0].get(cell)?,
            stillness: self.channels[1].get(cell)?,
            verdure: self.channels[2].get(cell)?,
            salting: self.channels[3].get(cell)?,
            ..self.base
        })
    }
}
pub fn toxicity(
    map: &mut Habitat<'_>,
    years: f64,
    forcing: &dyn Fn(usize) -> io::Result<Forcing>,
) -> io::Result<()> {
    for cell in 0..map.mesh.len() {
        let f = forcing(cell)?;
        map.set(
            S::EcologicalToxicity,
            cell,
            unit(
                f.toxicity.max(
                    map.get(S::EcologicalToxicity, cell)? * (-years * f.recovery / 600.0).exp(),
                ),
            ),
        )?;
    }
    Ok(())
}
