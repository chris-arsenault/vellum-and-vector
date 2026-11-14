//! Surface media operations retain carrier notifications and the material transfer record.
use super::{
    shared::{Scalar as S, SharedFields},
    Field,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError},
    lattice::TriangularLattice,
    rock::ground::Ground,
    scale::{LengthUnit, MapScale},
    storage::ReadBand,
    water::Water,
};
use std::{io, rc::Rc};
pub type MeltReceiver = Rc<dyn Fn(&mut Field, usize, f64, f64) -> io::Result<()>>;
pub struct IceResponse {
    pub cell: usize,
    pub next: f64,
    pub cause: String,
}
pub struct IceTransfer {
    pub from: usize,
    pub to: usize,
    pub volume: f64,
}
pub struct Melt {
    pub cell: usize,
    pub amount: f64,
    pub cause: String,
    pub beneath: bool,
    pub exposure: f64,
}
pub struct Spoil {
    pub cell: usize,
    pub share: f64,
    pub cause: String,
}
pub fn melted_inventory(held: f64, melted: f64, before: f64) -> f64 {
    if before > 0.0 {
        held.max(0.0) * (melted / before).clamp(0.0, 1.0)
    } else {
        0.0
    }
}
pub struct MeltReceipt {
    pub before: f64,
    pub melted: f64,
}
pub fn remove_ice(shared: &mut SharedFields, input: &Melt) -> io::Result<MeltReceipt> {
    let before = shared.scalar(S::IceThickness).get(input.cell)?;
    let melted = if input.exposure > 0.0 {
        input.amount.max(0.0).min(before)
    } else {
        0.0
    };
    if melted > 0.0 {
        shared
            .scalar_mut(S::IceThickness)
            .set(input.cell, before - melted)?;
    }
    Ok(MeltReceipt { before, melted })
}
pub fn record_melt(
    ground: &mut Ground,
    water: &mut Water,
    mesh: &TriangularLattice,
    input: &Melt,
    receipt: &MeltReceipt,
) -> io::Result<()> {
    if receipt.melted <= 0.0 {
        return Ok(());
    }
    ground.record_ice_melt(&input.cause, receipt.melted * mesh.area(input.cell));
    if input.beneath {
        water.receive_melt(
            input.cell,
            MapScale::in_units(receipt.melted, LengthUnit::Millimetre),
        )?;
    }
    Ok(())
}
fn failure(e: impl std::fmt::Display) -> ExecutionError {
    ExecutionError::Failed(e.to_string())
}
pub fn transfer(
    shared: &mut SharedFields,
    mesh: &TriangularLattice,
    input: &IceTransfer,
) -> io::Result<()> {
    let ice = shared.scalar_mut(S::IceThickness);
    let from = ice.get(input.from)?;
    let moved = input.volume.max(0.0).min(from * mesh.area(input.from));
    ice.set(input.from, from - moved / mesh.area(input.from))?;
    ice.set(input.to, ice.get(input.to)? + moved / mesh.area(input.to))
}
pub fn redistribute(
    shared: &mut SharedFields,
    mesh: &TriangularLattice,
    volumes: &ReadBand<f64>,
) -> io::Result<()> {
    let ice = shared.scalar_mut(S::IceThickness);
    for cell in 0..mesh.len() {
        ice.set(
            cell,
            (ice.get(cell)? + volumes.get(cell)? / mesh.area(cell)).max(0.0),
        )?;
    }
    Ok(())
}
impl Field {
    pub fn receive_ice_melt(receiver: MeltReceiver) -> Command<Self> {
        Command::new(
            "ice-melt-carrier",
            CommandKind::Initialize,
            vec![],
            move |field: &mut Field, _| {
                field.melt_receiver = Some(receiver.clone());
                Ok(())
            },
        )
    }
    pub fn ice_response() -> Command<Self, IceResponse> {
        Command::with_inputs(
            "ice-response",
            CommandKind::Work,
            vec![],
            |scope, input: &IceResponse| {
                scope
                    .state_mut()
                    .set_ice_response(input.cell, input.next, &input.cause)
                    .map_err(failure)
            },
        )
    }
    pub(super) fn set_ice_response(
        &mut self,
        cell: usize,
        next: f64,
        cause: &str,
    ) -> io::Result<()> {
        let before = self.shared.scalar(S::IceThickness).get(cell)?;
        if next < before {
            self.melt_surface_ice(&Melt {
                cell,
                amount: before - next.max(0.0),
                cause: cause.into(),
                beneath: false,
                exposure: 1.0,
            })?;
        } else {
            self.shared.scalar_mut(S::IceThickness).set(cell, next)?;
        }
        Ok(())
    }
    pub fn transfer_ice() -> Command<Self, IceTransfer> {
        Command::with_inputs(
            "transfer-ice",
            CommandKind::Work,
            vec![],
            |scope, input: &IceTransfer| {
                let field: &mut Field = scope.state_mut();
                transfer(&mut field.shared, &field.mesh, input).map_err(failure)
            },
        )
    }
    pub fn redistribute_ice() -> Command<Self, ReadBand<f64>> {
        Command::with_inputs(
            "redistribute-ice",
            CommandKind::Work,
            vec![],
            |scope, volumes: &ReadBand<f64>| {
                let field: &mut Field = scope.state_mut();
                redistribute(&mut field.shared, &field.mesh, volumes).map_err(failure)
            },
        )
    }
    pub fn melt_ice() -> Command<Self, Melt> {
        Command::with_inputs("melt-ice", CommandKind::Work, vec![], |scope, input| {
            scope
                .state_mut()
                .melt_surface_ice(input)
                .map(|_| ())
                .map_err(failure)
        })
    }
    fn melt_surface_ice(&mut self, input: &Melt) -> io::Result<f64> {
        let receipt = remove_ice(&mut self.shared, input)?;
        if receipt.melted <= 0.0 {
            return Ok(0.0);
        }
        if let Some(receiver) = self.melt_receiver.clone() {
            receiver(self, input.cell, receipt.melted, receipt.before)?;
        }
        record_melt(
            &mut self.ground.borrow_mut(),
            &mut self.water.borrow_mut(),
            &self.mesh,
            input,
            &receipt,
        )?;
        Ok(receipt.melted)
    }
    pub fn spoil_soil() -> Command<Self, Spoil> {
        Command::with_inputs(
            "spoil-soil",
            CommandKind::Work,
            vec![],
            |scope, input: &Spoil| {
                scope
                    .state_mut()
                    .ground
                    .borrow_mut()
                    .spoil_soil(input.cell, input.share, &input.cause)
                    .map_err(failure)
            },
        )
    }
}
