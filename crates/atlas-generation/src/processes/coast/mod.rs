// Arconis: docs/architecture/subsystems.arconis#item=g_coast — waves wear the coast by abrasion and plucking.
mod deposition;
pub mod frame;
use super::runner::{io_error, PhysicalContext};
use crate::{
    answers::AnswerBand,
    execution::{Command, CommandKind, Query},
    field::{material::MaterialWork, shared::Scalar as S, Field},
    rock::{catalogue, CompiledMix, ModeId, ModeMix},
    scale::{LengthUnit, MapScale, RelativeMeasure},
    scale_settings::{ResolvedSettings, ScaleDefinition},
    settlement::{
        removal::{Facet, RemovalGround},
        stage::{Pool, SurfaceAction},
    },
    storage::{Band, ReadBand},
};
use serde::Deserialize;
use std::io;
pub fn respond(
    book: &mut crate::answers::QuestionBook<Field, &'static str>,
    forcing: crate::execution::QueryDependency<Field>,
) -> crate::execution::ExecutionResult<()> {
    book.respond(
        "coastalForcing",
        crate::answers::Responder {
            by: "external waves".into(),
            queries: vec![forcing],
            kind: crate::answers::ResponseKind::Base(Box::new(|field, cell, _| {
                field
                    .shared()
                    .scalar(S::ExternalCoastalForcing)
                    .get(cell)
                    .map_err(|e| crate::execution::ExecutionError::Failed(e.to_string()))
            })),
        },
    )
}
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "CoastalErosionStrength":180,"CoastalDepositionFraction":580,
        "CoastalWearRate":{"kind":"relative-measure","fraction":1.5e-7,"dimension":1,"exponent":1},
        "CoastalPlatformDepth":{"kind":"relative-measure","fraction":0.0000075,"dimension":1,"exponent":1},
        "CoastalActiveWidth":{"kind":"relative-measure","fraction":0.0025,"dimension":1,"exponent":1},
        "CoastalDepositionReach":{"kind":"relative-measure","fraction":0.005,"dimension":1,"exponent":1},
        "CoastalSeaLevelChange":{"kind":"relative-measure","fraction":0,"dimension":1,"exponent":1}
    }})).expect("Declared coastal settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Settings {
    coastal_erosion_strength: f64,
    coastal_deposition_fraction: f64,
    coastal_wear_rate: f64,
    coastal_platform_depth: f64,
    coastal_active_width: f64,
    coastal_deposition_reach: f64,
    coastal_sea_level_change: f64,
}
fn cut(
    work: &mut MaterialWork<'_>,
    cell: usize,
    landing: usize,
    power: f64,
    platform: f64,
    mix: &CompiledMix,
) -> io::Result<f64> {
    let mut depths = [0.0; 2];
    for (index, facet) in Facet::ALL.into_iter().enumerate() {
        if work.ground.share(cell, facet)? <= 0.0 {
            continue;
        }
        depths[index] = work.ground.act_on(
            SurfaceAction {
                cell,
                mix,
                power,
                limit: (work.ground.surface(cell, facet)? - platform).max(0.0),
                direction: [0.0; 2],
            },
            facet,
        )?;
    }
    if depths[0] <= 0.0 && depths[1] <= 0.0 {
        return Ok(0.0);
    }
    let area = work.mesh.area(cell);
    let removed =
        work.ground
            .erode_facets(cell, depths, "coast", Pool::Load, &mut |mut material| {
                material.depth = MapScale::metres(material.depth, LengthUnit::Native) * area;
                work.load.add(landing, &material)
            })?;
    let band = work.shared.scalar_mut(S::CumulativeCoastalErosion);
    band.set(cell, band.get(cell)? + removed)?;
    let volume = MapScale::metres(removed, LengthUnit::Native) * area;
    work.ground.record_sediment_export(volume, 0.0);
    Ok(volume)
}
fn outside_forcing(work: &MaterialWork<'_>, forcing: &ReadBand<f64>) -> io::Result<()> {
    for cell in 0..work.mesh.len() {
        let amount = forcing.get(cell)?;
        if amount > 1000.0 || (amount > 0.0 && work.water.column.kind.get(cell)? != 0) {
            return Err(io::Error::other(
                "External coastal forcing must target dry terrain",
            ));
        }
    }
    Ok(())
}
struct Work<'a> {
    settings: &'a Settings,
    context: &'a PhysicalContext,
    frame: &'a frame::Frame,
    waves: &'a ReadBand<f64>,
    outside: bool,
}
fn wear(work: &mut MaterialWork<'_>, input: Work<'_>, loads: &mut Band<f64>) -> io::Result<()> {
    let p = input.settings;
    let c = input.context;
    let frame = input.frame;
    let mix = catalogue::compile(
        ModeMix::default()
            .with(ModeId::Abrasion, 0.6)
            .with(ModeId::Plucking, 0.4),
    );
    let change_scale = work
        .ground
        .scale()
        .resolve(RelativeMeasure::length(2.5e-7).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let platform = work.ground.effective_sea_level() - MapScale::native(p.coastal_platform_depth);
    for cell in 0..work.mesh.len() {
        let wave = frame.strength.get(cell)?;
        let coverage = frame.coverage.get(cell)?;
        let water = work.water.column.kind.get(cell)?;
        if input.outside {
            if wave <= 0.0 || coverage <= 0.0 {
                continue;
            }
            let band = work.shared.scalar_mut(S::ExternalCoastalForcingHistory);
            band.set(cell, band.get(cell)?.max(wave))?;
        } else {
            let observed = if water == 1 {
                input.waves.get(cell)?
            } else if coverage > 0.0 {
                wave
            } else {
                0.0
            };
            if water == 1 || coverage > 0.0 {
                let band = work.shared.scalar_mut(S::WaveExposureHistory);
                band.set(cell, band.get(cell)?.max(observed))?;
            }
            if wave <= 0.0 || water != 0 {
                continue;
            }
        }
        let forcing = if input.outside {
            wave
        } else {
            let steep = (work.shared.scalar(S::Slope).get(cell)? * 10000.0).clamp(0.0, 1000.0);
            wave * p.coastal_erosion_strength / 1000.0
                + steep / 18.0
                + p.coastal_sea_level_change.abs() / change_scale
        };
        let power = forcing * p.coastal_wear_rate * c.span * c.coastal_strength * coverage / 1000.0;
        let source = frame.source.get(cell)? as usize;
        let volume = cut(work, cell, source, power, platform, &mix)?;
        loads.set(source, loads.get(source)? + volume)?;
    }
    Ok(())
}
pub fn process(
    settings: &ResolvedSettings,
    waves: Query<Field, AnswerBand>,
    roots: Query<Field, AnswerBand>,
    forcing: Option<Query<Field, AnswerBand>>,
) -> io::Result<Command<Field, PhysicalContext>> {
    let p: Settings = serde_json::from_value(settings.values().clone())?;
    let mut dependencies = vec![waves.dependency(), roots.dependency()];
    if let Some(forcing) = &forcing {
        dependencies.push(forcing.dependency());
    }
    let id = if forcing.is_some() {
        "outside-waves"
    } else {
        "coast"
    };
    Ok(Field::material_command(
        id,
        CommandKind::Work,
        dependencies,
        move |work, context: &PhysicalContext, values| {
            work.ground
                .root_hold(Some(values.get(&roots).map_err(io_error)?.values()));
            let waves = values.get(&waves).map_err(io_error)?.values();
            let forcing = forcing
                .as_ref()
                .map(|q| values.get(q).map(|answer| answer.values()))
                .transpose()
                .map_err(io_error)?;
            if let Some(forcing) = &forcing {
                outside_forcing(work, forcing)?;
            }
            let frame = frame::frame(
                work,
                p.coastal_active_width * context.span,
                &waves,
                forcing.as_ref(),
            )?;
            let mut loads = work.coverage.scratch(work.mesh.len(), 0.0);
            wear(
                work,
                Work {
                    settings: &p,
                    context,
                    frame: &frame,
                    waves: &waves,
                    outside: forcing.is_some(),
                },
                &mut loads,
            )?;
            deposition::shores(work, &p, context.span, &frame, &loads, forcing.is_some())
        },
    ))
}
