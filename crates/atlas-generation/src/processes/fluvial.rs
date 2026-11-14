//! Current river-load transport, including deposition at mouths and retained closed-lake cargo.
use super::runner::io_error;
use crate::{
    answers::AnswerBand,
    execution::{Command, CommandKind, Query, QueryDependency},
    field::{material::MaterialWork, sediment::PassageQuestions, shared::Scalar, Field},
    flow_graph,
    rock::{ground::GroundField, load::MaterialLoad, material::MaterialLayer},
    scale::{LengthUnit, MapScale, RelativeMeasure},
    scale_settings::{ResolvedSettings, ScaleDefinition},
    settlement::{
        removal::{Facet, RemovalGround},
        stage::Pool,
    },
    storage::ReadBand,
    water::{column::Store, sediment::SedimentRouting},
};
use serde::Deserialize;
use std::io;

pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({
        "kind": "relative-settings", "values": {
            "SedimentTransportFraction": 760,
            "SedimentDepositionLength": {"kind":"relative-measure", "fraction":0.0025, "dimension":1, "exponent":1},
            "SedimentCarry": {"kind":"relative-measure", "fraction":0.025, "dimension":1, "exponent":1}
        }
    })).expect("Declared fluvial sediment settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Settings {
    sediment_transport_fraction: f64,
    sediment_deposition_length: f64,
    fluvial_equilibrium_gradient: f64,
    fluvial_reference_runoff: f64,
    open_bed_seepage: f64,
}
pub struct Context {
    pub span: f64,
    pub open_boundary: bool,
}
pub struct Operations {
    pub routing: Query<Field, SedimentRouting>,
    pub transport: Command<Field, Context>,
}
pub fn mouth_keeps(wave_exposure: f64, current_strength: f64) -> f64 {
    (1.0 - (wave_exposure / 1000.0).clamp(0.0, 1.0))
        * (1.0 - (current_strength / 1000.0).clamp(0.0, 1.0))
}
pub fn capture_fraction(fraction: f64, distance: f64, length: f64) -> f64 {
    -((-fraction / 1000.0).ln_1p() * distance / length).exp_m1()
}
fn surface(work: &MaterialWork<'_>, cell: usize) -> io::Result<f64> {
    if work.ground.share(cell, Facet::Cut)? > 0.0 {
        work.ground.surface(cell, Facet::Cut)
    } else {
        work.ground.view(GroundField::Elevation).get(cell)
    }
}
fn room(
    work: &MaterialWork<'_>,
    settings: &Settings,
    cell: usize,
    target: i32,
    still: bool,
    distance: f64,
) -> io::Result<f64> {
    let share = work.ground.share(cell, Facet::Cut)?;
    let share = if share == 0.0 { 1.0 } else { share };
    let floor = surface(work, cell)?;
    if work.water.column.kind.get(cell)? != 0 {
        return Ok((work
            .water
            .column
            .store(Store::Standing)
            .contents()
            .get(cell)?
            + work.ground.view(GroundField::Elevation).get(cell)?
            - floor)
            .max(0.0)
            * share);
    }
    let base = if target >= 0 {
        surface(work, target as usize)?
    } else {
        work.water.effective_sea_level
    };
    let area = work
        .ground
        .scale()
        .resolve(
            RelativeMeasure::new(0.00000625, 2, 1.0, LengthUnit::Metre)
                .map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?
        .value();
    let catchment = work.water.flow.catchment.get(cell)? / area;
    let grade = settings.fluvial_equilibrium_gradient / catchment.max(1.0).powf(0.12);
    Ok(
        (base + MapScale::native(if still { 0.0 } else { grade * distance }) - floor).max(0.0)
            * share,
    )
}
fn deposit(
    work: &mut MaterialWork<'_>,
    cell: usize,
    fits: f64,
    moving: &MaterialLoad,
    only: Option<Facet>,
) -> io::Result<f64> {
    if fits <= 0.0 {
        return Ok(0.0);
    }
    work.ground.deposit_package(
        cell,
        &[MaterialLayer {
            depth: fits,
            ..moving.get(cell)?
        }],
        "river-load",
        Pool::Load,
        only,
    )
}
pub(crate) fn settle_at_sea(
    work: &mut MaterialWork<'_>,
    cell: usize,
    moving: &mut MaterialLoad,
) -> io::Result<()> {
    let load = moving.amount(cell)?;
    if load <= 0.0 {
        return Ok(());
    }
    let area = work.mesh.area(cell);
    let kept = load
        * mouth_keeps(
            work.shared.scalar(Scalar::WaveExposure).get(cell)?,
            work.shared.scalar(Scalar::OceanCurrentStrength).get(cell)?,
        );
    let fits = MapScale::in_units(kept / area, LengthUnit::Native).min(
        (work.water.effective_sea_level - work.ground.view(GroundField::Elevation).get(cell)?)
            .max(0.0),
    );
    let laid = deposit(work, cell, fits, moving, None)?;
    moving.take(cell, MapScale::metres(laid, LengthUnit::Native) * area)?;
    let rest = moving.amount(cell)?;
    if rest > 0.0 {
        work.ground.carry_out(
            rest,
            "river-load",
            Some(&moving.take(cell, rest)?),
            Some((cell, work.sea_load)),
        )?;
    }
    Ok(())
}
fn distance(
    work: &MaterialWork<'_>,
    cell: usize,
    previous: &ReadBand<i32>,
    targets: &ReadBand<i32>,
) -> io::Result<f64> {
    let target = targets.get(cell)?;
    let next = if target >= 0 {
        target
    } else {
        previous.get(cell)?
    };
    if next < 0 {
        return Ok(work.mesh.area(cell).sqrt());
    }
    let here = work.mesh.position(cell);
    let there = work.mesh.position(next as usize);
    let dx = work.mesh.delta_x(there[0] - here[0]);
    let dy = there[1] - here[1];
    let length = dx.hypot(dy);
    if length == 0.0 {
        return Ok(work.mesh.area(cell).sqrt());
    }
    Ok((if dx == 0.0 {
        f64::INFINITY
    } else {
        work.mesh.cell_span() * length / dx.abs()
    })
    .min(if dy == 0.0 {
        f64::INFINITY
    } else {
        work.mesh.cell_span() * length / dy.abs()
    }))
}
fn release(
    work: &mut MaterialWork<'_>,
    cell: usize,
    material: &MaterialLayer,
    open_boundary: bool,
) -> io::Result<()> {
    let open = work.mesh.boundary(cell)
        && (open_boundary
            || (work.mesh.open_boundary()
                && work.water.drainage.parents.get(cell)? < 0
                && work.water.drainage.ranks.get(cell)? >= 0));
    if open {
        work.ground
            .carry_out(material.depth, "river-load", Some(material), None)
    } else {
        work.load.add(cell, material)
    }
}
fn execute(
    work: &mut MaterialWork<'_>,
    settings: &Settings,
    context: &Context,
    routing: &SedimentRouting,
    carries: &ReadBand<f64>,
) -> io::Result<()> {
    let mut moving = MaterialLoad::new(work.coverage);
    let targets = routing.targets();
    let water = routing.water();
    let mut previous = work.coverage.scratch(work.mesh.len(), -1i32);
    for cell in 0..work.mesh.len() {
        if let Ok(target) = usize::try_from(targets.get(cell)?) {
            previous.set(target, cell as i32)?;
        }
    }
    let order = flow_graph::target_order(work.coverage, &targets)?;
    for at in 0..order.len() {
        let cell = order.get(at)? as usize;
        let area = work.mesh.area(cell);
        if work.water.column.kind.get(cell)? == 1 {
            // owner-direction(2026-11-13): add the river-mouth sediment deposition process back.
            settle_at_sea(work, cell, &mut moving)?;
            let own_floor = work.load.take(cell, work.load.amount(cell)?)?;
            work.ground.carry_out(
                own_floor.depth,
                "river-load",
                Some(&own_floor),
                Some((cell, work.sea_load)),
            )?;
            continue;
        }
        moving.add(cell, &work.load.take(cell, work.load.amount(cell)?)?)?;
        let load = moving.amount(cell)?;
        if load <= 0.0 {
            continue;
        }
        let target = targets.get(cell)?;
        let still = work.water.column.kind.get(cell)? == 2
            || (target >= 0 && work.water.column.kind.get(target as usize)? == 1);
        let capacity = if still {
            0.0
        } else {
            carries.get(cell)? * water.get(cell)? * context.span
        };
        let travelled = distance(work, cell, &previous.read_only(), &targets)?;
        let dropped = (load - capacity).max(0.0)
            * capture_fraction(
                settings.sediment_transport_fraction,
                travelled,
                settings.sediment_deposition_length,
            );
        let fits = MapScale::in_units(dropped / area, LengthUnit::Native)
            .min(room(work, settings, cell, target, still, travelled)?);
        let only = (work.ground.share(cell, Facet::Cut)? > 0.0).then_some(Facet::Cut);
        let deposited = deposit(work, cell, fits, &moving, only)?;
        moving.take(cell, MapScale::metres(deposited, LengthUnit::Native) * area)?;
        let carried = moving.take(cell, moving.amount(cell)?)?;
        if target >= 0 {
            moving.add(target as usize, &carried)?;
        } else {
            release(work, cell, &carried, context.open_boundary)?;
        }
    }
    Ok(())
}
pub fn operations(
    settings: &ResolvedSettings,
    passage: PassageQuestions,
    capacity: Query<Field, AnswerBand>,
    dependencies: Vec<QueryDependency<Field>>,
) -> io::Result<Operations> {
    let settings: Settings = serde_json::from_value(settings.values().clone())?;
    let routing = Field::sediment_routing(
        passage,
        settings.fluvial_reference_runoff,
        settings.open_bed_seepage,
        dependencies,
    );
    let inputs = routing.clone();
    let transport = Field::material_command(
        "sediment-transport",
        CommandKind::Work,
        vec![routing.dependency(), capacity.dependency()],
        move |work, context, values| {
            execute(
                work,
                &settings,
                context,
                values.get(&inputs).map_err(io_error)?.as_ref(),
                &values.get(&capacity).map_err(io_error)?.values(),
            )
        },
    );
    Ok(Operations { routing, transport })
}
