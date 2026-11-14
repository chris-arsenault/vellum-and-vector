use super::runner::{FieldStage, StageProcess, StageWork};
use crate::{
    field::{
        water::{
            drainage,
            streams::{PreparedRouting, Questions, Settings as RoutingSettings},
        },
        Field,
    },
    rock::{catalogue, CompiledMix, ModeId, ModeMix},
    scale::{LengthUnit, MapScale, RelativeMeasure},
    scale_settings::{ResolvedSettings, ScaleDefinition},
    settlement::{
        removal::Facet,
        stage::{SurfaceAction, WearCause},
    },
    storage::ReadBand,
};
use serde::Deserialize;
use std::{io, rc::Rc};
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "FluvialErosionStepsPerSpan":13,"FluvialEquilibriumGradient":0.0015,"FluvialAreaExponent":0.5,
        "FluvialPowerScale":1548,"FluvialValleyWidthShare":0.05,"FluvialFineChannelShare":1.0/3.0,"FluvialFineGradientShare":0.53,
        "FluvialErosionRate":{"kind":"relative-measure","fraction":0.00000104,"dimension":1,"exponent":1},
        "FluvialReferenceRunoff":{"kind":"relative-measure","fraction":7.5e-8,"dimension":1,"exponent":1,"unit":"mm"},
        "FluvialChannelArea":{"kind":"relative-measure","fraction":0.0001875,"dimension":2,"exponent":1}
    }})).expect("Declared stream erosion settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Settings {
    fluvial_erosion_steps_per_span: f64,
    fluvial_equilibrium_gradient: f64,
    fluvial_area_exponent: f64,
    fluvial_power_scale: f64,
    fluvial_valley_width_share: f64,
    fluvial_fine_channel_share: f64,
    fluvial_fine_gradient_share: f64,
    fluvial_erosion_rate: f64,
    fluvial_reference_runoff: f64,
    fluvial_channel_area: f64,
    open_bed_seepage: f64,
}
pub fn valley_share(width_share: f64, catchment: f64, area: f64) -> f64 {
    (width_share * catchment.sqrt() / area.sqrt()).clamp(0.0, 1.0)
}
struct Cutting<'a> {
    settings: &'a Settings,
    work: &'a StageWork,
    mix: &'a CompiledMix,
    cause: &'a WearCause,
    targets: ReadBand<i32>,
    water: ReadBand<f64>,
}
fn cut(stage: &mut FieldStage<'_, '_>, cut: &Cutting<'_>, cell: usize) -> io::Result<()> {
    let Ok(target) = usize::try_from(cut.targets.get(cell)?) else {
        return Ok(());
    };
    if stage.ground().water().column.kind.get(cell)? == 1 {
        return Ok(());
    }
    let p = cut.settings;
    let mesh = stage.mesh();
    let here = mesh.position(cell);
    let there = mesh.position(target);
    let direction = [mesh.delta_x(there[0] - here[0]), there[1] - here[1]];
    let length = direction[0].hypot(direction[1]);
    let elevation = &stage.ground().water().drainage.elevations;
    let fall = (MapScale::metres(
        elevation.get(cell)? - elevation.get(target)?,
        LengthUnit::Native,
    ) / length)
        .max(0.0);
    let scale = stage.ground().read().scale();
    let reference = scale
        .resolve(
            RelativeMeasure::new(0.00000625, 2, 1.0, LengthUnit::Metre)
                .map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?
        .value();
    let catchment = cut.water.get(cell)? / reference;
    let equilibrium = p.fluvial_equilibrium_gradient / catchment.max(1.0).powf(0.12);
    let steep = (fall - equilibrium).max(0.0);
    if steep <= 0.0 {
        return Ok(());
    }
    let power = catchment.powf(p.fluvial_area_exponent)
        * steep
        * p.fluvial_power_scale
        * p.fluvial_erosion_rate;
    let depth = stage.ground().read().act_on(
        SurfaceAction {
            cell,
            mix: cut.mix,
            power: power * cut.work.span * cut.work.context.hydrology_strength / 1000.0,
            limit: MapScale::native(steep * length),
            direction,
        },
        Facet::Cut,
    )?;
    if depth <= 0.0 {
        return Ok(());
    }
    let share = valley_share(
        p.fluvial_valley_width_share,
        cut.water.get(cell)?,
        mesh.area(cell),
    );
    stage.cut(
        cut.cause,
        cell,
        depth,
        share,
        cut.water.get(cell)? >= p.fluvial_channel_area,
    )
}
pub fn process(
    settings: &ResolvedSettings,
    drainage: Rc<drainage::Settings>,
    open_boundary: bool,
    refined: bool,
    questions: Questions,
) -> io::Result<StageProcess> {
    let mut p: Settings = serde_json::from_value(settings.values().clone())?;
    if refined {
        p.fluvial_channel_area *= p.fluvial_fine_channel_share;
        p.fluvial_equilibrium_gradient *= p.fluvial_fine_gradient_share;
    }
    let steps = p.fluvial_erosion_steps_per_span;
    let prepared: PreparedRouting = Rc::default();
    let dependencies = questions.dependencies();
    let prepare = Field::stream_preparation(
        RoutingSettings {
            drainage,
            open_boundary,
            reference_runoff: p.fluvial_reference_runoff,
            open_bed_seepage: p.open_bed_seepage,
        },
        questions,
        prepared.clone(),
    );
    let mix = catalogue::compile(ModeMix::default().with(ModeId::Abrasion, 1.0));
    let cause = WearCause {
        id: "streams".into(),
        remembers: "CumulativeFluvialErosion".into(),
        past_base_level: false,
    };
    Ok(StageProcess::new(
        "streams",
        dependencies,
        move |c| steps * c.span,
        move |stage, work, _| {
            if work.context.hydrology_strength == 0.0 {
                return Ok(());
            }
            let prepared = prepared.borrow();
            let routes = prepared.as_ref().ok_or_else(|| {
                io::Error::other("Stream routes were not prepared for this substep")
            })?;
            let input = Cutting {
                settings: &p,
                work,
                mix: &mix,
                cause: &cause,
                targets: routes.targets(),
                water: routes.water(),
            };
            for cell in 0..stage.mesh().len() {
                cut(stage, &input, cell)?;
            }
            Ok(())
        },
    )
    .prepared_by(prepare))
}
use crate::settlement::removal::RemovalGround;
