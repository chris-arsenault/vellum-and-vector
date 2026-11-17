//! The source independent-map relief synthesis, using the captured gradient and current rock.
use crate::{
    execution::{Command, CommandKind},
    field::{inheritance::resources::Resource, Field},
    noise::fractal_noise,
    reconstruction::{Interpolator, Layout},
    rock::ground::queries::{surface_response, SurfaceResponse},
    scale::{LengthUnit, MapScale},
};
use serde::Deserialize;
use std::{cell::RefCell, io};

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    pub relief_synthesis_gain: f64,
    pub relief_synthesis_anisotropy: f64,
    pub regional_relief_minimum_slope: f64,
}
#[derive(Default)]
pub struct Summary {
    pub changed: usize,
    pub rms_metres: f64,
}
pub struct Input<'a> {
    pub parent: &'a Resource,
    pub seed: i32,
    pub settings: &'a Settings,
    pub result: &'a RefCell<Summary>,
}
fn parent_span(parent: &Resource) -> f64 {
    if let Some(span) = parent.resolution.filter(|span| *span != 0.0) {
        return span;
    }
    let [x0, y0, x1, y1] = parent.grid.bounds;
    match parent.grid.layout {
        Layout::Adaptive(_) => (x1 - x0).max(y1 - y0),
        Layout::Raster { width, height } => {
            ((x1 - x0) / (width - 1) as f64).max((y1 - y0) / (height - 1) as f64)
        }
    }
}
pub fn synthesize<'a>() -> Command<Field, Input<'a>> {
    Command::with_inputs(
        "atlas.independent-relief",
        CommandKind::Event,
        vec![],
        |scope, input: &Input<'_>| {
            let field = scope.state_mut();
            let channel =
                input.parent.channels.get("Elevation").ok_or_else(|| {
                    io::Error::other("Adaptive relief requires captured elevation")
                })?;
            let mut coverage = field.coverage.borrow_mut();
            let mut sampler = Interpolator::new(&input.parent.grid, false, &mut coverage);
            // A real-scale map can sit inside one parent cell: its relief varies at its own
            // size at most, never at the parent's cell span (ADR 0016).
            let atlas_map::Bounds(w, s, e, n) = field.mesh.bounds();
            let span = parent_span(input.parent).min((e - w).max(n - s));
            if !span.is_finite() || span <= 0.0 {
                return Err(
                    io::Error::other("Captured elevation requires a positive resolution").into(),
                );
            }
            let mut ground = field.ground.borrow_mut();
            let standing = surface_response(SurfaceResponse::Standing);
            let [ox, oy] = field.mesh.origin();
            let mut result = Summary::default();
            let mut square = 0.0;
            // owner-direction(2026-10-29): child elevation and coastline may change freely, including at their edges
            for cell in 0..field.mesh.len() {
                let [x, y] = field.mesh.position(cell);
                let x = ox + x;
                let y = oy + y;
                let mut at = |point| sampler.sample(point, &|donor| channel.values.get(donor));
                let gx = MapScale::metres(
                    at([x + span / 2.0, y])? - at([x - span / 2.0, y])?,
                    LengthUnit::Native,
                ) / span;
                let gy = MapScale::metres(
                    at([x, y + span / 2.0])? - at([x, y - span / 2.0])?,
                    LengthUnit::Native,
                ) / span;
                let gradient = gx.hypot(gy);
                let amplitude = input.settings.relief_synthesis_gain
                    * (input.settings.regional_relief_minimum_slope * span).max(gradient * span)
                    * ground.fold(cell, &standing, None)?;
                if amplitude <= 0.0 {
                    continue;
                }
                let [ax, ay] = if gradient > 0.0 {
                    [gx / gradient, gy / gradient]
                } else {
                    [1.0, 0.0]
                };
                let minimum = field.mesh.area(cell).sqrt() * 2.0;
                let scale = (span / 2.0).max(minimum);
                let octaves = (1.0 + (scale / minimum).log2().floor()).max(1.0) as usize;
                let delta = amplitude
                    * fractal_noise(
                        x * ax + y * ay,
                        (-x * ay + y * ax) / input.settings.relief_synthesis_anisotropy,
                        input.seed ^ 0x5e1f,
                        scale,
                        octaves,
                    );
                let applied = MapScale::native(delta);
                if applied == 0.0 {
                    continue;
                }
                ground.displace(cell, applied, "regional")?;
                result.changed += 1;
                square += delta * delta;
            }
            result.rms_metres = if result.changed > 0 {
                (square / result.changed as f64).sqrt()
            } else {
                0.0
            };
            *input.result.borrow_mut() = result;
            Ok(())
        },
    )
}
