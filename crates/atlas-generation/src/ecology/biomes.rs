use super::{
    environment::{is_wetland, Environment},
    ReadHabitat,
};
use crate::field::shared::Scalar as S;
use std::io;
#[derive(Clone, Copy)]
#[repr(i32)]
pub enum Biome {
    Unclassified,
    Ocean,
    Freshwater,
    Ice,
    Barren,
    Desert,
    Tundra,
    Grassland,
    Savanna,
    Woodland,
    TemperateForest,
    BorealForest,
    Rainforest,
    Marsh,
    Swamp,
    EmberGrove,
    ThawMeadow,
    RimeForest,
    GlowLichenBarrens,
    FogHeath,
    MossForest,
    Deepwood,
    WendingFen,
    WellMeadow,
    BarrowHeath,
    SaltPan,
    GlassFlat,
}
pub const NAMES: [&str; 27] = [
    "Unclassified",
    "Ocean",
    "Freshwater",
    "Ice",
    "Barren",
    "Desert",
    "Tundra",
    "Grassland",
    "Savanna",
    "Woodland",
    "Temperate forest",
    "Boreal forest",
    "Rainforest",
    "Marsh",
    "Swamp",
    "Ember grove",
    "Thaw meadow",
    "Rime forest",
    "Glow-lichen barrens",
    "Fog heath",
    "Moss forest",
    "Deepwood",
    "Wending fen",
    "Well meadow",
    "Barrow heath",
    "Salt pan",
    "Glass flat",
];
pub fn classify(map: &impl ReadHabitat, cell: usize, e: &Environment) -> io::Result<Biome> {
    if e.frozen {
        return Ok(Biome::Ice);
    }
    if e.water == 1 {
        return Ok(Biome::Ocean);
    }
    if e.submerged {
        return Ok(Biome::Freshwater);
    }
    if let Some(biome) = magical(map, cell)? {
        return Ok(biome);
    }
    if is_wetland(map, cell)? {
        return Ok(if map.get(S::TreeCover, cell)? > 0.2 {
            Biome::Swamp
        } else {
            Biome::Marsh
        });
    }
    if e.temperature < 2.0 {
        return Ok(Biome::Tundra);
    }
    cover(map, cell, e)
}
fn magical(map: &impl ReadHabitat, cell: usize) -> io::Result<Option<Biome>> {
    let trees = map.get(S::BroadleafCover, cell)? + map.get(S::ConiferCover, cell)?;
    let cover = map.get(S::TreeCover, cell)?
        + map.get(S::GrassCover, cell)?
        + map.get(S::WetlandCover, cell)?;
    if map.get(S::Quickening, cell)? >= 0.25 && cover >= 0.12 {
        return Ok(Some(if trees >= 0.3 {
            Biome::EmberGrove
        } else {
            Biome::ThawMeadow
        }));
    }
    if map.get(S::Stillness, cell)? >= 0.45 {
        if trees >= 0.3 {
            return Ok(Some(Biome::RimeForest));
        }
        if cover < 0.12 {
            return Ok(Some(Biome::GlowLichenBarrens));
        }
    }
    if map.get(S::FogForcing, cell)? >= 0.3 && cover >= 0.12 {
        return Ok(Some(if trees >= 0.4 {
            Biome::MossForest
        } else {
            Biome::FogHeath
        }));
    }
    verdant(map, cell, trees, cover)
}
fn verdant(
    map: &impl ReadHabitat,
    cell: usize,
    trees: f64,
    cover: f64,
) -> io::Result<Option<Biome>> {
    if map.get(S::Verdure, cell)? < 0.3 || cover < 0.12 {
        return Ok(None);
    }
    Ok(Some(if trees >= 0.5 {
        Biome::Deepwood
    } else if map.get(S::WetlandCover, cell)? >= 0.3 {
        Biome::WendingFen
    } else {
        Biome::WellMeadow
    }))
}
fn cover(map: &impl ReadHabitat, cell: usize, e: &Environment) -> io::Result<Biome> {
    let trees = map.get(S::TreeCover, cell)?;
    let cover = trees + map.get(S::GrassCover, cell)? + map.get(S::WetlandCover, cell)?;
    if cover < 0.12 {
        return Ok(if e.moisture < 0.25 {
            Biome::Desert
        } else {
            Biome::Barren
        });
    }
    if trees < 0.15 {
        return Ok(Biome::Grassland);
    }
    if trees < 0.4 {
        return Ok(if e.temperature > 18.0 {
            Biome::Savanna
        } else {
            Biome::Woodland
        });
    }
    if map.get(S::ConiferCover, cell)? > map.get(S::BroadleafCover, cell)? || e.temperature < 8.0 {
        return Ok(Biome::BorealForest);
    }
    Ok(if e.temperature > 22.0 && e.moisture > 0.7 {
        Biome::Rainforest
    } else {
        Biome::TemperateForest
    })
}
