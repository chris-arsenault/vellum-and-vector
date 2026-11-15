//! Water, warmth and frost open rock; a deep mantle shields the material beneath it.
use super::runner::{io_error, StageProcess};
use crate::{
    answers::AnswerBand,
    execution::Query,
    field::Field,
    rock::{catalogue, ModeId, ModeMix},
    scale_settings::{ResolvedSettings, ScaleDefinition},
    settlement::stage::Forcing,
};
use serde::Deserialize;
use std::{io, rc::Rc};

pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({
        "kind": "relative-settings", "values": {
            "WeatheringPerSpan": {"kind":"relative-measure", "fraction":0.00003, "dimension":1, "exponent":1},
            "WeatheringShieldDepth": {"kind":"relative-measure", "fraction":0.00001, "dimension":1, "exponent":1}
        }
    })).expect("Declared weathering settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Settings {
    weathering_per_span: f64,
    weathering_shield_depth: f64,
}
pub struct Questions {
    pub wetness: Query<Field, AnswerBand>,
    pub warmth: Query<Field, AnswerBand>,
    pub frost: Query<Field, AnswerBand>,
}
// Arconis: docs/architecture/subsystems.arconis#item=c_wet — weathering breaks rock down in place from wetness, warmth, frost.
pub fn process(
    settings: &ResolvedSettings,
    passes: f64,
    questions: Questions,
) -> io::Result<StageProcess> {
    let settings: Settings = serde_json::from_value(settings.values().clone())?;
    super::runner::require_passes(passes)?;
    let rate = settings.weathering_per_span / passes;
    let forcing = Forcing {
        mix: Rc::new(catalogue::compile(
            ModeMix::default()
                .with(ModeId::Plucking, 0.5)
                .with(ModeId::Solution, 0.5),
        )),
        shield_depth: settings.weathering_shield_depth,
    };
    Ok(StageProcess::new(
        "weathering",
        vec![
            questions.wetness.dependency(),
            questions.warmth.dependency(),
            questions.frost.dependency(),
        ],
        |_| 1.0,
        move |stage, work, values| {
            let wetness = values.get(&questions.wetness).map_err(io_error)?.values();
            let warmth = values.get(&questions.warmth).map_err(io_error)?.values();
            let frost = values.get(&questions.frost).map_err(io_error)?.values();
            let water_kind = stage.ground().water().column.kind.clone();
            for cell in 0..stage.mesh().len() {
                if water_kind.get(cell)? != 0 {
                    continue;
                }
                let driven = wetness.get(cell)? * warmth.get(cell)? + frost.get(cell)?;
                let power = driven * rate * work.span * work.context.hydrology_strength / 1000.0;
                stage.weather_action(cell, forcing.clone(), power, "weathering")?;
            }
            Ok(())
        },
    ))
}
