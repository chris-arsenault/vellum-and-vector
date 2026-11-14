mod faces;
mod flux;
use super::runner::{io_error, PhysicalContext};
use crate::{
    answers::AnswerBand,
    execution::{Command, CommandKind, Query},
    field::Field,
    scale_settings::{ResolvedSettings, ScaleDefinition},
    settlement::{removal::Facet, stage::Stage, Sharing},
};
use serde::Deserialize;
use std::io;
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "SlopeRoundsAtMost":24,"SlopeRoundsSettled":0.05,"MassWastingStableGradient":0.7,
        "HillslopeLength":{"kind":"relative-measure","fraction":0.00025,"dimension":1,"exponent":1}
    }}))
    .expect("Declared slope settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Settings {
    slope_rounds_at_most: f64,
    slope_rounds_settled: f64,
    mass_wasting_stable_gradient: f64,
}
/// Each failure round settles before the next reads the changed contacts.
pub fn process(
    id: &'static str,
    settings: &ResolvedSettings,
    root_hold: Query<Field, AnswerBand>,
) -> io::Result<Command<Field, PhysicalContext>> {
    let p: Settings = serde_json::from_value(settings.values().clone())?;
    Ok(Field::material_command(
        id,
        CommandKind::Work,
        vec![root_hold.dependency()],
        move |work, _, values| {
            work.ground
                .root_hold(Some(values.get(&root_hold).map_err(io_error)?.values()));
            let mut first = 0.0;
            for _ in 0..p.slope_rounds_at_most.ceil().max(0.0) as usize {
                let mut routes = flux::hillslope(
                    work.ground,
                    work.mesh,
                    work.coverage,
                    p.mass_wasting_stable_gradient,
                )?;
                let mut moved = 0.0;
                let mut stage = Stage::new(
                    work.ground,
                    work.coverage,
                    work.mesh,
                    work.load,
                    Sharing::Sequential,
                );
                while let Some((source, [target, volume, facet])) = routes.pop() {
                    stage.move_surface(
                        source as usize,
                        target as usize,
                        volume,
                        id,
                        if facet < 0.0 {
                            None
                        } else if facet == 0.0 {
                            Some(Facet::Land)
                        } else {
                            Some(Facet::Cut)
                        },
                    )?;
                    moved += volume;
                }
                stage.settle()?;
                if first == 0.0 {
                    first = moved;
                }
                if moved <= first * p.slope_rounds_settled {
                    return Ok(());
                }
            }
            Ok(())
        },
    ))
}
