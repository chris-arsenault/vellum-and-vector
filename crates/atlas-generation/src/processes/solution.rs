//! Water dissolves soluble material through the same rock interaction and stage settlement.
// Arconis: docs/architecture/subsystems.arconis#item=g_sol — water dissolves soluble rock through the solution mode.
use super::runner::{io_error, StageProcess};
use crate::{
    answers::AnswerBand,
    execution::Query,
    field::Field,
    rock::{catalogue, ModeId, ModeMix},
    scale_settings::{ResolvedSettings, ScaleDefinition},
    settlement::stage::{SurfaceAction, WearCause},
};
use serde::Deserialize;
use std::io;

pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({
        "kind": "relative-settings", "values": {
            "DissolvedPerSpan": {"kind":"relative-measure", "fraction":0.00002, "dimension":1, "exponent":1}
        }
    })).expect("Declared solution settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Settings {
    dissolved_per_span: f64,
}

pub fn process(
    settings: &ResolvedSettings,
    passes: f64,
    wetness: Query<Field, AnswerBand>,
) -> io::Result<StageProcess> {
    let settings: Settings = serde_json::from_value(settings.values().clone())?;
    super::runner::require_passes(passes)?;
    let rate = settings.dissolved_per_span / passes;
    let dissolving = catalogue::compile(ModeMix::default().with(ModeId::Solution, 1.0));
    let dissolved = WearCause {
        id: "solution".into(),
        remembers: "CumulativeFluvialErosion".into(),
        past_base_level: false,
    };
    Ok(StageProcess::new(
        "solution",
        vec![wetness.dependency()],
        |_| 1.0,
        move |stage, work, values| {
            let wetness = values.get(&wetness).map_err(io_error)?.values();
            let water_kind = stage.ground().water().column.kind.clone();
            for cell in 0..stage.mesh().len() {
                if water_kind.get(cell)? == 1 {
                    continue;
                }
                stage.attack(
                    &dissolved,
                    SurfaceAction {
                        cell,
                        mix: &dissolving,
                        power: rate
                            * work.span
                            * wetness.get(cell)?
                            * work.context.hydrology_strength
                            / 1000.0,
                        limit: f64::INFINITY,
                        direction: [0.0; 2],
                    },
                )?;
            }
            Ok(())
        },
    ))
}
