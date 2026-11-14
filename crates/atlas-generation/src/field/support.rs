use super::{
    crust_settings::Settings,
    shared::{CellCode, Flag, Scalar},
    Field,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError, Query},
    metric::smoothing::smooth,
    processes::runner::PhysicalContext,
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::{Band, ReadBand},
    tectonics::controls,
};
use std::io;

fn failure(error: impl std::fmt::Display) -> ExecutionError {
    ExecutionError::Failed(error.to_string())
}
fn length(scale: MapScale, share: f64) -> io::Result<f64> {
    Ok(scale
        .resolve(RelativeMeasure::length(share).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
impl Field {
    pub fn crustal_support(settings: Settings) -> Query<Self, ReadBand<f64>> {
        Query::new("crustal-support", vec![], move |field: &Field, query| {
            let context = query.input::<PhysicalContext>()?;
            field.update_support(&settings, &context).map_err(failure)?;
            Ok(field.ground().view(G::CrustSupportTarget))
        })
    }
    fn update_support(&self, p: &Settings, context: &PhysicalContext) -> io::Result<()> {
        let mut ground = self.ground.try_borrow_mut().map_err(io::Error::other)?;
        let fraction = ground.view(G::CrustContinentalFraction);
        let thickness = ground.view(G::CrustThickness);
        let rock = ground.view(G::SurfaceRockLoad);
        let sediment = ground.view(G::SedimentThickness);
        let fields = &self.shared;
        let rift_depth = controls::rift_subsidence(self.scale).map_err(io::Error::other)?
            * p.continental_assembly_separation_depth
            * p.margin_evolution_response_per_mille
            / 1000.0;
        let trench_scale = MapScale::native(length(self.scale, 0.00025)?);
        for cell in 0..self.mesh.len() {
            let f = fraction.get(cell)? / 1000.0;
            let bounded = f.clamp(0.0, 1.0);
            let foundation = length(self.scale, 0.00025 + 0.00075 * bounded)?;
            let height = MapScale::metres(thickness.get(cell)?, LengthUnit::Native).round();
            let airy = MapScale::native(
                length(self.scale, -0.00005 + 0.0001 * bounded)?
                    + (height - foundation) * (300.0 + 400.0 * bounded) / 1000.0,
            );
            let oceanic = (1.0 - f / p.oceanic_subsidence_composition_limit).clamp(0.0, 1.0);
            let subsidence = MapScale::native(
                oceanic * fields.scalar(Scalar::CrustAge).get(cell)? / 1000.0
                    * p.oceanic_subsidence_depth,
            );
            let cooling = MapScale::native(
                rift_depth
                    * (fields.scalar(Scalar::CrustRiftStrain).get(cell)? / controls::RIFT_FAILURE)
                        .clamp(0.0, 1.0)
                    * (1.0
                        - (-fields.scalar(Scalar::CrustRiftAgeMyr).get(cell)?
                            / controls::RIFT_COOLING_MYR)
                            .exp()),
            );
            let mut load = (rock.get(cell)? * 800.0 / 1000.0).trunc()
                + (sediment.get(cell)? * p.sediment_load_response_per_mille / 1000.0).trunc();
            if fields.flag(Flag::GroundedIce).get(cell)? != 0 {
                load += (MapScale::native(fields.scalar(Scalar::IceThickness).get(cell)?)
                    * p.ice_load_response_per_mille
                    / 1000.0)
                    .trunc();
            }
            let trench = if context.tectonic_strength > 0.0
                && fields.code(CellCode::TectonicBoundaryCodes).get(cell)? == 1
            {
                let consumed =
                    fields.scalar(Scalar::OceanicSubductionHistory).get(cell)? / trench_scale;
                MapScale::native(p.convergent_trench_depth * (1.0 - f) * (1.0 - (-consumed).exp()))
            } else {
                0.0
            };
            ground.set_support_target(cell, airy - subsidence - cooling - trench - load)?;
        }
        Ok(())
    }
    fn settled_support(&self, p: &Settings) -> io::Result<Band<f64>> {
        let mut coverage = self.coverage.try_borrow_mut().map_err(io::Error::other)?;
        let ground = self.ground();
        let fraction = ground.view(G::CrustContinentalFraction);
        let target = ground.view(G::CrustSupportTarget);
        let mut continent = coverage.allocate(0u8);
        let mut ocean = coverage.allocate(0u8);
        for cell in 0..self.mesh.len() {
            let land = fraction.get(cell)? >= p.oceanic_subsidence_composition_limit * 1000.0;
            continent.set(cell, u8::from(land))?;
            ocean.set(cell, u8::from(!land))?;
        }
        let on_continent = smooth(
            &self.mesh,
            &mut coverage,
            &target,
            p.lithospheric_flexure_length,
            Some(&continent.read_only()),
        )?;
        smooth(
            &self.mesh,
            &mut coverage,
            &on_continent.read_only(),
            p.lithospheric_flexure_length,
            Some(&ocean.read_only()),
        )
    }
    pub fn lithospheric_flexure(
        settings: Settings,
        support: Query<Self, ReadBand<f64>>,
    ) -> Command<Self> {
        Command::new(
            "lithospheric-flexure",
            CommandKind::Work,
            vec![support.optional_dependency()],
            move |field: &mut Field, _| {
                let current = field.settled_support(&settings).map_err(failure)?;
                field
                    .ground
                    .try_borrow_mut()
                    .map_err(failure)?
                    .support_field(
                        &current.read_only(),
                        field.support_datum.as_ref().map(|b| b.read_only()).as_ref(),
                        field.coverage.get_mut(),
                    )
                    .map_err(failure)
            },
        )
    }
    pub fn capture_support_datum(settings: Settings) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "capture-support-datum",
            CommandKind::Initialize,
            vec![],
            move |scope, context| {
                let field: &mut Field = scope.state_mut();
                field.update_support(&settings, context).map_err(failure)?;
                let initial = field.settled_support(&settings).map_err(failure)?;
                let elevation = field.ground().view(G::CrustSupportElevation);
                let mut datum = field.coverage.get_mut().allocate(0.0);
                for cell in 0..field.mesh.len() {
                    datum
                        .set(
                            cell,
                            elevation.get(cell).map_err(failure)?
                                - initial.get(cell).map_err(failure)?,
                        )
                        .map_err(failure)?;
                }
                field.support_datum = Some(datum);
                Ok(())
            },
        )
    }
}
