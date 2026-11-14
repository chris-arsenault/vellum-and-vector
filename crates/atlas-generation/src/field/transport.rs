//! One history move composes scalar transport, crust and every registered owner carrier.
use super::{
    shared::{CellCode, Scalar},
    Field,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError},
    rock::ground::{crust::CrustTransport, GroundField},
    storage::Band,
    transport::{
        carriers::Carriers,
        quantities::{IdentityChoice, QuantityKind},
        scatter::{area_weights, ScalarTransport},
        HistoryTransport,
    },
};
use std::io;

fn failure(error: impl std::fmt::Display) -> ExecutionError {
    ExecutionError::Failed(error.to_string())
}
struct Picking {
    field: CellCode,
    values: Band<i32>,
    held: Band<f64>,
}
impl Field {
    pub fn transport_history(carriers: Carriers<Self>) -> Command<Self, HistoryTransport> {
        let human_history = crate::human::history::transport_records(|field: &mut Field| {
            (
                &mut field.people,
                field.coverage.get_mut(),
                field.shared.code(CellCode::TectonicBoundaryCodes),
            )
        });
        Command::with_inputs(
            "field.transport-history",
            CommandKind::Event,
            vec![],
            move |context, plan: &HistoryTransport| {
                context.run(&human_history, plan)?;
                let picks = context.state_mut().move_quantities(plan).map_err(failure)?;
                carriers.carry(context, &plan.shares)?;
                context
                    .state_mut()
                    .settle_identities(picks)
                    .map_err(failure)
            },
        )
    }
    fn pick_identities(&mut self, plan: &HistoryTransport) -> io::Result<Vec<Picking>> {
        let mut picks = Vec::new();
        for &field in CellCode::ALL {
            if field.quantity() != QuantityKind::Identity {
                continue;
            }
            let coverage = self.coverage.get_mut();
            let mut pick = Picking {
                field,
                values: coverage.scratch(self.mesh.len(), field.initial()),
                held: coverage.scratch(self.mesh.len(), 0.0),
            };
            let values = self.shared.code(field);
            if let Some(rule) = field.identity_rule() {
                for source in 0..self.mesh.len() {
                    let id = values.get(source)?;
                    let by = if field == CellCode::CrustAssemblyIds {
                        self.ground
                            .borrow()
                            .view(GroundField::CrustContinentalFraction)
                            .get(source)?
                    } else {
                        1.0
                    };
                    for offset in
                        plan.shares.offsets.get(source)?..plan.shares.offsets.get(source + 1)?
                    {
                        let offset = offset as usize;
                        let target = plan.shares.targets.get(offset)?;
                        if target < 0 {
                            continue;
                        }
                        let target = target as usize;
                        let mut choice = IdentityChoice {
                            value: pick.values.get(target)?,
                            held: pick.held.get(target)?,
                        };
                        choice.offer(&rule, id, plan.shares.weights.get(offset)?, by);
                        pick.values.set(target, choice.value)?;
                        pick.held.set(target, choice.held)?;
                    }
                }
            } else {
                for target in 0..self.mesh.len() {
                    let source = plan.shares.dominant.get(target)?;
                    pick.values.set(
                        target,
                        if source >= 0 {
                            values.get(source as usize)?
                        } else {
                            0
                        },
                    )?;
                }
            }
            picks.push(pick);
        }
        Ok(picks)
    }
    fn move_quantities(&mut self, plan: &HistoryTransport) -> io::Result<Vec<Picking>> {
        let picks = self.pick_identities(plan)?;
        let coverage = self.coverage.get_mut();
        let weights = area_weights(coverage, &plan.shares, |cell| self.mesh.area(cell))?;
        let mut scratch = coverage.scratch(self.mesh.len(), 0.0);
        let boundaries = self.shared.code(CellCode::TectonicBoundaryCodes);
        let transport = ScalarTransport {
            shares: &plan.shares,
            arrivals: &plan.arrivals,
            boundaries: &boundaries,
            weights: &weights.read_only(),
        };
        let mut ground = self.ground.try_borrow_mut().map_err(io::Error::other)?;
        ground.transport_load(&plan.shares, &mut self.ground_load, coverage)?;
        ground.transport_load(&plan.shares, &mut self.sea_load, coverage)?;
        let crust = ground.capture_crust(coverage)?;
        for &field in Scalar::ALL {
            let kind = field.quantity();
            if matches!(
                kind,
                QuantityKind::Share | QuantityKind::Amount | QuantityKind::Peak
            ) {
                transport.apply(self.shared.scalar_mut(field), kind, &mut scratch)?;
            }
        }
        ground.transport_history(&transport, &mut scratch)?;
        self.water
            .try_borrow_mut()
            .map_err(io::Error::other)?
            .transport_history(&transport, &mut scratch)?;
        ground.transport_crust(
            &CrustTransport {
                shares: &plan.shares,
                arrivals: &plan.arrivals,
                boundaries: &boundaries,
            },
            &crust,
            coverage,
            &mut |cell, consumed, reserve| {
                for field in [Scalar::OceanicSubduction, Scalar::OceanicSubductionHistory] {
                    let band = self.shared.scalar_mut(field);
                    band.set(cell, band.get(cell)? + consumed)?;
                }
                self.shared
                    .scalar_mut(Scalar::ConvergentCrustSurplus)
                    .set(cell, reserve)
            },
        )?;
        Ok(picks)
    }
    fn settle_identities(&mut self, picks: Vec<Picking>) -> io::Result<()> {
        for pick in picks {
            for cell in 0..self.mesh.len() {
                let mut value = pick.values.get(cell)?;
                if let Some(rule) = pick.field.identity_rule() {
                    let holds = match pick.field {
                        CellCode::CrustAssemblyIds => {
                            self.ground
                                .borrow()
                                .view(GroundField::CrustContinentalFraction)
                                .get(cell)?
                                > 0.0
                        }
                        CellCode::VolcanicLastActiveEpoch | CellCode::FeatureFlags => {
                            self.shared
                                .scalar(Scalar::VolcanicConstructionHistory)
                                .get(cell)?
                                > 0.0
                        }
                        _ => true,
                    };
                    value = IdentityChoice { value, held: 0.0 }.settle(
                        &rule,
                        holds,
                        pick.field.initial(),
                    );
                }
                self.shared.code_mut(pick.field).set(cell, value)?;
            }
        }
        Ok(())
    }
    /// Default owners register beside the field assembly; additional owners use the same book.
    pub fn carriers() -> Result<Carriers<Self>, ExecutionError> {
        let mut carriers = Carriers::default();
        carriers.register("human", Self::human_operations().carry)?;
        carriers.register(
            "water",
            Command::with_inputs(
                "water.carry-ground",
                CommandKind::Event,
                vec![],
                |context, shares| {
                    let field: &mut Field = context.state_mut();
                    field
                        .water
                        .try_borrow_mut()
                        .map_err(failure)?
                        .carry_ground(shares, field.coverage.get_mut())
                        .map_err(failure)
                },
            ),
        )?;
        Ok(carriers)
    }
}
