use super::{Ground, GroundField as F};
use crate::{
    rock::{
        catalogue::{material, BASALT},
        columns::Column,
        load::MaterialLoad,
        material::MaterialLayer,
    },
    scale::{LengthUnit, MapScale, RelativeMeasure},
    settlement::stage::Pool,
    storage::Coverage,
    transport::{TransportShares, TRANSPORT_WEIGHT_SCALE},
};
use std::io;
impl Ground {
    pub fn carry_out(
        &mut self,
        volume: f64,
        cause: &str,
        material: Option<&MaterialLayer>,
        receiving: Option<(usize, &mut MaterialLoad)>,
    ) -> io::Result<()> {
        self.exported += volume;
        if let (Some(material), Some((cell, load))) = (material, receiving) {
            if volume > 0.0 {
                load.add(
                    cell,
                    &MaterialLayer {
                        depth: volume,
                        ..material.clone()
                    },
                )?;
            }
        }
        self.record_flow(cause, Pool::Load, Pool::Sea, volume);
        Ok(())
    }
    /// Load arriving from beyond the map edge, the reverse of `carry_out`.
    pub fn carry_in(&mut self, volume: f64, cause: &str) {
        self.record_flow(cause, Pool::Sea, Pool::Load, volume);
    }
    pub fn transport_load(
        &mut self,
        plan: &TransportShares,
        current: &mut MaterialLoad,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let mut arriving = MaterialLoad::new(coverage);
        for source in 0..self.mesh.len() {
            let material = self.identities.released_material(current.get(source)?);
            if material.depth <= 0.0 {
                continue;
            }
            let retained = distribute(&mut arriving, source, plan, &material)?;
            // Ground arriving from beyond the edge rides this row but is not this cell's own.
            let inflow = plan.inflow.get(source)?;
            let lost = material.depth * (1.0 - (retained - inflow)).max(0.0);
            if lost > 0.0 {
                self.carry_out(lost, "plates", None, None)?;
            }
            self.carry_in(material.depth * inflow, "plates");
        }
        for cell in 0..self.mesh.len() {
            current.clear(cell)?;
            current.add(cell, &arriving.get(cell)?)?;
        }
        Ok(())
    }
    /// New ocean crust replaces the abandoned donor, including all finite cargo and cover.
    pub fn form_transport_opening(&mut self, cell: usize) -> io::Result<()> {
        for field in super::transport::MATERIAL_FIELDS
            .into_iter()
            .chain(super::transport::SHEET_FIELDS)
        {
            self.set(field, cell, 0.0)?;
        }
        for column in Column::ALL {
            for slot in 0..column.size() {
                self.columns
                    .set_layer(cell, column, slot, &MaterialLayer::default())?;
            }
        }
        self.set(F::GroundCutCover, cell, 0.0)?;
        self.set(F::SurfaceRockLoad, cell, 0.0)?;
        let fraction = (self.get(F::CrustContinentalFraction, cell)? / 1000.0).clamp(0.0, 1.0);
        let foundation = self.relative_length(0.00025 + 0.00075 * fraction)?;
        let crust = MapScale::metres(self.get(F::CrustThickness, cell)?, LengthUnit::Native);
        let height = self.relative_length(-0.00005 + 0.0001 * fraction)?
            + (crust - foundation) * (300.0 + 400.0 * fraction) / 1000.0;
        self.set(F::CrustSupportElevation, cell, MapScale::native(height))?;
        self.set(F::BedrockElevation, cell, MapScale::native(height))?;
        let basalt = material(
            BASALT,
            MapScale::native(self.relative_length(0.002)?),
            self.epoch,
        );
        self.columns.set_layer(cell, Column::Land, 0, &basalt)?;
        self.project(cell)
    }
    pub(super) fn relative_length(&self, fraction: f64) -> io::Result<f64> {
        Ok(self
            .scale
            .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value())
    }
}
fn distribute(
    arriving: &mut MaterialLoad,
    source: usize,
    plan: &TransportShares,
    material: &MaterialLayer,
) -> io::Result<f64> {
    let mut retained = 0.0;
    for offset in plan.offsets.get(source)?..plan.offsets.get(source + 1)? {
        let target = plan.targets.get(offset as usize)?;
        let share = plan.weights.get(offset as usize)? / TRANSPORT_WEIGHT_SCALE;
        if target < 0 || share <= 0.0 {
            continue;
        }
        arriving.add(
            target as usize,
            &MaterialLayer {
                depth: material.depth * share,
                ..material.clone()
            },
        )?;
        retained += share;
    }
    Ok(retained)
}
