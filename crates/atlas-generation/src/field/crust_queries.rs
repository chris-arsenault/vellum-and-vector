use super::{
    crust_settings::Settings,
    shared::{CellCode as C, Scalar as S},
    Field,
};
use crate::{
    execution::{ExecutionError, Query},
    noise::mesh_noise,
    processes::runner::PhysicalContext,
    scale::RelativeMeasure,
    storage::ReadBand,
};
use std::io;

fn failure(error: impl std::fmt::Display) -> ExecutionError {
    ExecutionError::Failed(error.to_string())
}
impl Field {
    pub fn continental_domains(settings: Settings) -> Query<Self, ReadBand<f64>> {
        Query::new(
            "continental-domains",
            vec![],
            move |field: &Field, scope| {
                let context = scope.input::<PhysicalContext>()?;
                field
                    .update_domains(&settings, context.seed)
                    .map_err(failure)?;
                Ok(field.shared.scalar(S::ContinentalPotential))
            },
        )
    }
    fn update_domains(&self, p: &Settings, seed: i32) -> io::Result<()> {
        let potential = self.shared.scalar(S::CrustBasePotential);
        let strain = self.shared.scalar(S::TectonicStrain);
        let boundary = self.shared.code(C::TectonicBoundaryCodes);
        let mut result = self.shared.derive_scalar(S::ContinentalPotential);
        for cell in 0..self.mesh.len() {
            let value = potential.get(cell)? / 1000.0;
            let [x, y] = self.mesh.position(cell);
            let roughness = mesh_noise(
                &self.mesh,
                x,
                y,
                seed ^ 0x41c7,
                p.continental_warp_scale * 0.44,
                4,
            );
            let margin = 1.0 - ((value - 0.5).abs() * 2.0).clamp(0.0, 1.0);
            let adjustment = match boundary.get(cell)? {
                1 => strain.get(cell)? / 1000.0 * 0.07,
                2 => strain.get(cell)? / 1000.0 * -0.12,
                _ => 0.0,
            };
            let value =
                (value + roughness * (0.025 + margin * margin * 0.14) + adjustment).clamp(0.0, 1.0);
            result.set(cell, (value * value * (3.0 - 2.0 * value) * 1000.0).round())?;
        }
        Ok(())
    }
    pub fn geothermal(settings: Settings) -> Query<Self, ReadBand<f64>> {
        Query::new("geothermal", vec![], move |field: &Field, scope| {
            let context = scope.input::<PhysicalContext>()?;
            field
                .update_geothermal(&settings, context.seed)
                .map_err(failure)?;
            Ok(field.shared.scalar(S::Geothermal))
        })
    }
    fn update_geothermal(&self, p: &Settings, seed: i32) -> io::Result<()> {
        const VENT: i32 = 1;
        const PLUME: i32 = 1 << 6;
        let completed = self.ground().completed_epochs();
        let broad_scale = self
            .scale
            .resolve(RelativeMeasure::length(0.035).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value()
            .max(self.mesh.content_radius() * 0.34);
        let fields = &self.shared;
        let mut flags = fields.derive_code(C::FeatureFlags);
        let mut geothermal = fields.derive_scalar(S::Geothermal);
        let mut density = fields.derive_scalar(S::HeatSourceDensity);
        for cell in 0..self.mesh.len() {
            let mut flag = flags.get(cell)? & !VENT;
            let strain = fields.scalar(S::TectonicStrain).get(cell)?;
            let fracture = fields.scalar(S::FractureConductance).get(cell)?;
            let volcanic = fields.scalar(S::VolcanicActivity).get(cell)?;
            let [x, y] = self.mesh.position(cell);
            let boundary = [0.0, 0.43, 0.58, 0.24]
                [fields.code(C::TectonicBoundaryCodes).get(cell)? as usize]
                * strain
                / 1000.0;
            let impact = fields.scalar(S::ImpactHeat).get(cell)? / 1000.0 * 0.36
                / (completed + 1.0).max(1.0);
            let lobes = mesh_noise(&self.mesh, x, y, seed ^ 0x4d13, p.plume_lobe_scale, 3);
            let plume =
                volcanic / 1000.0 * 0.68 * (1.0 + lobes * p.plume_lobe_strength / 1000.0).max(0.0);
            let broad = (mesh_noise(&self.mesh, x, y, seed, broad_scale, 2) + 1.0) * 0.5 * 0.1;
            let heat = ((boundary + fracture / 1000.0 * 0.28 + impact + plume + broad)
                .clamp(0.0, 1.0)
                * 1000.0)
                .round();
            geothermal.set(cell, heat)?;
            density.set(
                cell,
                ((heat * 2.0 + fracture + strain + volcanic) / 4.0)
                    .trunc()
                    .clamp(0.0, 1000.0),
            )?;
            let provenance =
                strain >= 180.0 || fracture >= 560.0 || volcanic > 0.0 || flag & PLUME != 0;
            if heat >= p.geothermal_vent_threshold && provenance {
                flag |= VENT;
            }
            flags.set(cell, flag)?;
        }
        Ok(())
    }
}
