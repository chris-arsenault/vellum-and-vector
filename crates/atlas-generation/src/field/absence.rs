//! Omitted processes leave no events of their own; absence does not claim an input was produced.
use super::{
    events::EventKind,
    shared::{CellCode, Flag, FloatField, Scalar},
    Field,
};
use crate::execution::{Command, CommandKind};
// hpc-exempt: names of omitted process histories, never cell-indexed data.
use std::{collections::BTreeSet, io};

const NEUTRAL: &[(&str, &[&str])] = &[
    (
        "Impacts",
        &[
            "ImpactExcavation",
            "ImpactRimUplift",
            "ImpactEjectaThickness",
            "ImpactHeat",
        ],
    ),
    (
        "VolcanicConstruction",
        &[
            "VolcanicConstructionHistory",
            "VolcanicActivity",
            "MantlePlumeRootStrength",
        ],
    ),
    ("MantlePlumeRoots", &["MantlePlumeRootStrength"]),
    (
        "GlacialEvolution",
        &["CumulativeGlacialErosion", "CumulativeGlacialDeposition"],
    ),
    (
        "CoastalEvolution",
        &[
            "CumulativeCoastalErosion",
            "ExternalCoastalForcing",
            "ExternalCoastalForcingHistory",
        ],
    ),
    ("Floodplains", &["FloodplainIntensity"]),
    ("Deltas", &["DeltaIntensity"]),
    ("Geothermal", &["Geothermal", "GeothermalHistory"]),
    ("OrogenicConstruction", &["OrogenicConstruction"]),
    ("SeaIce", &["SeaIceSuitability"]),
    (
        "LandIce",
        &[
            "IceThickness",
            "MaximumIceThickness",
            "GroundedIce",
            "IceBalance",
        ],
    ),
    (
        "IceFlow",
        &["IceFlux", "MaximumIceFlux", "MaximumGroundedIceFlux"],
    ),
    (
        "OceanCurrents",
        &[
            "OceanCurrentX",
            "OceanCurrentY",
            "OceanCurrentHeat",
            "OceanCurrentStrength",
            "SeaSurfaceAnomaly",
            "Upwelling",
            "WaveExposure",
        ],
    ),
    ("Warmth", &["Warmth"]),
    ("Landforms", &["LandformCodes"]),
];
fn clear_shared(field: &mut Field, name: &str) -> io::Result<()> {
    for cell in 0..field.mesh.len() {
        if let Some(band) = Scalar::named(name) {
            field.shared.scalar_mut(band).set(cell, 0.0)?;
        } else if let Some(band) = CellCode::named(name) {
            field.shared.code_mut(band).set(cell, 0)?;
        } else if let Some(band) = FloatField::named(name) {
            field.shared.float_mut(band).set(cell, 0.0)?;
        } else if let Some(band) = Flag::named(name) {
            field.shared.flag_mut(band).set(cell, 0)?;
        } else {
            return Err(io::Error::other(format!(
                "Absent history has no field binding: {name}"
            )));
        }
    }
    Ok(())
}
// hpc-exempt: names of omitted process histories, never cell-indexed data.
fn special(field: &mut Field, absent: &BTreeSet<String>) -> io::Result<()> {
    if absent.contains("GlacialMeltwater") {
        field.water.borrow_mut().clear_glacial_meltwater()?;
    }
    if absent.contains("VolcanicConstruction") {
        for cell in 0..field.mesh.len() {
            field
                .shared
                .code_mut(CellCode::VolcanicLastActiveEpoch)
                .set(cell, -1)?;
        }
        field.events.retain(|event| event.kind == EventKind::Impact);
    }
    if absent.contains("Impacts") {
        field.events.retain(|event| event.kind != EventKind::Impact);
    }
    if absent.contains("Fractures") {
        field.faults.clear();
    }
    if absent.contains("RiverGeometry") {
        field.water.borrow_mut().clear_channel_geometry()?;
    }
    if absent.contains("SeaIce") {
        let water = field.water().column.kind;
        for cell in 0..field.mesh.len() {
            if water.get(cell)? == 1 {
                field
                    .shared
                    .scalar_mut(Scalar::IceThickness)
                    .set(cell, 0.0)?;
            }
        }
    }
    Ok(())
}
// hpc-exempt: names of omitted process histories, never cell-indexed data.
pub fn initialize(absent: BTreeSet<String>) -> Command<Field> {
    Command::new(
        "atlas.absent-physical",
        CommandKind::Initialize,
        vec![],
        move |field: &mut Field, _| {
            for (history, names) in NEUTRAL {
                if absent.contains(*history) {
                    for name in *names {
                        clear_shared(field, name)?;
                    }
                }
            }
            special(field, &absent)?;
            Ok(())
        },
    )
}
