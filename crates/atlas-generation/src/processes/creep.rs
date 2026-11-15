//! Loose cover moves down every lower face, limited by its mantle and local levelling.
// Arconis: docs/architecture/subsystems.arconis#item=g_slope — loose cover creeps downslope by shear.
use super::runner::{FieldStage, StageProcess};
use crate::{
    rock::{catalogue, ground::GroundField, CompiledMix, ModeId, ModeMix},
    scale::{LengthUnit, MapScale},
    scale_settings::{ResolvedSettings, ScaleDefinition},
};
use serde::Deserialize;
use std::io;

pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({
        "kind": "relative-settings", "values": {
            "CreepPerSpan": {"kind":"relative-measure", "fraction":0.000125, "dimension":2, "exponent":1}
        }
    })).expect("Declared creep settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Settings {
    creep_per_span: f64,
}

pub fn levelling(drop: f64, area: f64, faces: usize, other_faces: usize) -> f64 {
    drop.max(0.0) * area / (1 + faces.max(other_faces)) as f64
}

fn each_fall(
    stage: &FieldStage<'_, '_>,
    cell: usize,
    mut send: impl FnMut(usize, f64, f64) -> io::Result<()>,
) -> io::Result<()> {
    let mesh = stage.mesh();
    let elevation = stage.ground().read().view(GroundField::Elevation);
    for edge in 0..3 {
        let Some(target) = mesh.neighbor(cell, edge) else {
            continue;
        };
        let drop = MapScale::metres(
            elevation.get(cell)? - elevation.get(target)?,
            LengthUnit::Native,
        );
        if drop > 0.0 {
            send(
                target,
                drop,
                mesh.face_length(cell, edge) / mesh.edge_length(cell, edge),
            )?;
        }
    }
    Ok(())
}

fn creep_from(
    stage: &mut FieldStage<'_, '_>,
    cell: usize,
    rate: f64,
    mix: &CompiledMix,
) -> io::Result<()> {
    let mantle = MapScale::metres(
        stage
            .ground()
            .read()
            .view(GroundField::SedimentThickness)
            .get(cell)?,
        LengthUnit::Native,
    ) * stage.mesh().area(cell);
    if mantle <= 0.0 || stage.ground().water().column.kind.get(cell)? == 1 {
        return Ok(());
    }
    let moves = stage.ground().read().gives(cell, mix, [0.0; 2])? * rate;
    let mut wanted = 0.0;
    each_fall(stage, cell, |_, drop, width| {
        wanted += moves * drop * width;
        Ok(())
    })?;
    if wanted <= 0.0 {
        return Ok(());
    }
    let share = (mantle / wanted).min(1.0);
    // A triangular cell has three faces, including its boundary faces.
    let mut routes = [(0usize, 0.0); 3];
    let mut count = 0;
    each_fall(stage, cell, |target, drop, width| {
        let volume = (share * moves * drop * width).min(levelling(
            drop,
            stage.mesh().area(cell).min(stage.mesh().area(target)),
            3,
            3,
        ));
        routes[count] = (target, volume);
        count += 1;
        Ok(())
    })?;
    for &(target, volume) in &routes[..count] {
        stage.move_loose(cell, target, volume, "creep")?;
    }
    Ok(())
}

pub fn process(settings: &ResolvedSettings, passes: f64) -> io::Result<StageProcess> {
    let settings: Settings = serde_json::from_value(settings.values().clone())?;
    super::runner::require_passes(passes)?;
    let rate = settings.creep_per_span / passes;
    let mix = catalogue::compile(ModeMix::default().with(ModeId::Shear, 1.0));
    Ok(StageProcess::new(
        "creep",
        vec![],
        |_| 1.0,
        move |stage, work, _| {
            for cell in 0..stage.mesh().len() {
                creep_from(stage, cell, rate * work.span, &mix)?;
            }
            Ok(())
        },
    ))
}
