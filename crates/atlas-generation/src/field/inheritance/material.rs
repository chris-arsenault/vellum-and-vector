use super::Samples;
use crate::{
    field::FieldSeed,
    rock::{columns::Column, ground::GroundField, material::MaterialLayer},
};
use std::io;

fn layer(
    samples: &Samples,
    cell: usize,
    name: impl Fn(&str) -> String,
) -> io::Result<MaterialLayer> {
    let get = |part| samples.require(&name(part), cell);
    Ok(MaterialLayer {
        kind: get("Kind")? as usize,
        secondary_kind: get("SecondaryKind")? as usize,
        mixed: get("Mixed")?,
        depth: get("Depth")?,
        secondary_share: get("SecondaryShare")?,
        strength: get("Strength")?,
        damage: get("Damage")?,
        grain_x: get("GrainX")?,
        grain_y: get("GrainY")?,
        bed_slope_x: get("BedSlopeX")?,
        bed_slope_y: get("BedSlopeY")?,
        deposited: get("Deposited")?,
        consolidation: get("Consolidation")?,
        formed_min: get("FormedMin")?,
        formed_max: get("FormedMax")?,
        altered: get("Altered")?,
        cargo: None,
    })
}
pub(super) fn install(samples: &Samples, seed: &mut FieldSeed, cell: usize) -> io::Result<()> {
    for field in GroundField::ALL {
        if let Some(value) = samples.get(field.name(), cell)? {
            seed.ground.storage.initialize(field, cell, value)?;
        }
    }
    for (column, prefix) in [
        (Column::Land, "RockLayer"),
        (Column::Cut, "RockCutLayer"),
        (Column::Loose, "LooseLayer"),
        (Column::CutLoose, "LooseCutLayer"),
    ] {
        for slot in 0..column.size() {
            let material = layer(samples, cell, |part| format!("{prefix}{part}{slot}"))?;
            seed.ground
                .columns
                .set_layer(cell, column, slot, &material)?;
        }
    }
    for (load, prefix) in [
        (&mut seed.ground_load, "GroundLoad"),
        (&mut seed.sea_load, "SeaLoad"),
    ] {
        let material = layer(samples, cell, |part| {
            format!("{prefix}{}", if part == "Depth" { "Volume" } else { part })
        })?;
        load.import(cell, &material)?;
    }
    Ok(())
}
