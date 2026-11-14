use super::{shared::CellCode, Field};
use crate::{
    execution::{Command, CommandKind, ExecutionError},
    noise::mesh_noise,
    processes::runner::PhysicalContext,
    rock::ground::GroundField,
    scale::{MapScale, RelativeMeasure},
    scale_settings::{ResolvedSettings, ScaleDefinition},
};
use serde::Deserialize;
use std::io;

pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "CoastalDetailBand":{"kind":"relative-measure","fraction":0.0000225,"dimension":1,"exponent":1},
        "CoastalDetailStrength":1000,
        "CoastalDetailScale":{"kind":"relative-measure","fraction":0.0175,"dimension":1,"exponent":1},
        "CoastalDetailWarp":{"kind":"relative-measure","fraction":0.0065,"dimension":1,"exponent":1},
        "CoastalDetailPassiveAmplitude":{"kind":"relative-measure","fraction":0.0000155,"dimension":1,"exponent":1},
        "CoastalDetailConvergentAmplitude":{"kind":"relative-measure","fraction":0.000022,"dimension":1,"exponent":1},
        "CoastalDetailRiftedAmplitude":{"kind":"relative-measure","fraction":0.0000185,"dimension":1,"exponent":1},
        "CoastalDetailTransformAmplitude":{"kind":"relative-measure","fraction":0.0000085,"dimension":1,"exponent":1}
    }})).expect("Declared coastal detail settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    coastal_detail_band: f64,
    coastal_detail_strength: f64,
    coastal_detail_scale: f64,
    coastal_detail_warp: f64,
    coastal_detail_passive_amplitude: f64,
    coastal_detail_convergent_amplitude: f64,
    coastal_detail_rifted_amplitude: f64,
    coastal_detail_transform_amplitude: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
impl Field {
    /// The full atlas binds its captured offshore pressure and magic feedback to this query.
    pub fn coastal_forcing(
        dependencies: Vec<crate::execution::QueryDependency<Self>>,
    ) -> crate::execution::Query<Self, ()> {
        crate::execution::Query::new("coastal-forcing", dependencies, |field: &Field, _| {
            let mut forcing = field
                .shared
                .derive_scalar(super::shared::Scalar::ExternalCoastalForcing);
            for cell in 0..field.mesh.len() {
                forcing.set(cell, 0.0)?;
            }
            Ok(())
        })
    }
    pub fn coastal_detail(settings: Settings) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "coastal-detail",
            CommandKind::Event,
            vec![],
            move |scope, context: &PhysicalContext| {
                scope
                    .state_mut()
                    .apply_coastal_detail(&settings, context.seed)
                    .map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
    fn apply_coastal_detail(&mut self, p: &Settings, seed: i32) -> io::Result<()> {
        let band = MapScale::native(p.coastal_detail_band);
        if band <= 0.0 || p.coastal_detail_strength <= 0.0 {
            return Ok(());
        }
        let length = |fraction| -> io::Result<f64> {
            Ok(self
                .scale
                .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
                .map_err(io::Error::other)?
                .value())
        };
        let minimum = length(2.5e-7)?;
        let offset = [length(0.22925)?, length(0.10775)?];
        let amplitudes = [
            0.0,
            p.coastal_detail_passive_amplitude,
            p.coastal_detail_convergent_amplitude,
            p.coastal_detail_rifted_amplitude,
            p.coastal_detail_transform_amplitude,
        ];
        let mut ground = self.ground.try_borrow_mut().map_err(io::Error::other)?;
        for cell in 0..self.mesh.len() {
            let height =
                ground.view(GroundField::Elevation).get(cell)? - ground.effective_sea_level();
            if height.abs() > band {
                continue;
            }
            let margin = self.shared.code(CellCode::MarginCodes).get(cell)? as usize;
            let amplitude = amplitudes[margin];
            if amplitude <= 0.0 {
                continue;
            }
            let scale = p.coastal_detail_scale * [1.0, 1.0, 0.55, 0.7, 1.3][margin];
            let warp = p.coastal_detail_warp * [0.0, 1.0, 1.6, 0.7, 0.35][margin];
            let octaves = [4, 6, 6, 5, 4][margin];
            let [x, y] = self.mesh.position(cell);
            let warp_scale = minimum.max(scale * 1.7);
            let wx = mesh_noise(&self.mesh, x, y, seed ^ 0x51a3, warp_scale, 3) * warp;
            let wy = mesh_noise(
                &self.mesh,
                x + offset[0],
                y - offset[1],
                seed ^ 0x51a3,
                warp_scale,
                3,
            ) * warp;
            let value = mesh_noise(&self.mesh, x + wx, y + wy, seed ^ 0x7c4b, scale, octaves);
            let noise = if margin == 2 || margin == 3 {
                2.0 * value.abs() - 1.0
            } else {
                value
            };
            let displacement = noise * amplitude * (1.0 - height.abs() / band).powi(2);
            let delta = MapScale::native(displacement * p.coastal_detail_strength / 1000.0);
            if delta != 0.0 {
                ground.displace(cell, delta, "shore-detail")?;
            }
        }
        Ok(())
    }
}
