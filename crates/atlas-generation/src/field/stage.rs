//! Settlement uses the ground owner and the field's existing history channels.
use super::{
    shared::{Scalar, SharedFields},
    Field,
};
use crate::{
    answers::AnswerBand,
    execution::{Command, CommandKind, ExecutionError, Query, QueryDependency, QueryValues},
    rock::{ground::Ground, material::MaterialLayer},
    scale::MapScale,
    settlement::{removal::*, stage::*, Sharing},
    water::WaterView,
};
use std::io;

pub struct StagePreparation<P> {
    pub root_hold: Option<Query<Field, AnswerBand>>,
    pub commands: Vec<Command<Field, P>>,
}

pub struct FieldGround<'a> {
    ground: &'a mut Ground,
    shared: &'a mut SharedFields,
    water: WaterView,
}
impl FieldGround<'_> {
    /// Processes can inspect material but only the stage can obtain its writer.
    /// ```compile_fail
    /// use atlas_generation::field::stage::FieldGround;
    /// fn spill(ground: &FieldGround<'_>) { ground.read().soil_depth(0, 1.0); }
    /// ```
    pub fn read(&self) -> &Ground {
        self.ground
    }
    pub fn water(&self) -> &WaterView {
        &self.water
    }
    pub fn shared(&self) -> &SharedFields {
        self.shared
    }
}
impl RemovalGround for FieldGround<'_> {
    fn count(&self) -> usize {
        self.ground.count()
    }
    fn scale(&self) -> &MapScale {
        self.ground.scale()
    }
    fn sea_level(&self) -> f64 {
        self.ground.sea_level()
    }
    fn marine(&self, cell: usize) -> io::Result<bool> {
        self.ground.marine(cell)
    }
    fn facet(&self, cell: usize, facet: Facet) -> io::Result<FacetState> {
        self.ground.facet(cell, facet)
    }
    fn sediment(&self, cell: usize) -> io::Result<f64> {
        self.ground.sediment(cell)
    }
    fn soil(&self, cell: usize) -> io::Result<f64> {
        self.ground.soil(cell)
    }
    fn withdraw(
        &mut self,
        action: Withdrawal<'_>,
        receive: &mut dyn FnMut(MaterialLayer) -> io::Result<()>,
    ) -> io::Result<f64> {
        self.ground.withdraw(action, receive)
    }
    fn cut(
        &mut self,
        action: Cut<'_>,
        receive: &mut dyn FnMut(MaterialLayer) -> io::Result<()>,
    ) -> io::Result<CutReceipt> {
        self.ground.cut(action, receive)
    }
}
impl StageGround for FieldGround<'_> {
    fn surface_action(&self, action: SurfaceAction<'_>) -> io::Result<[f64; 2]> {
        self.ground.surface_action(action)
    }
    fn deposit(&mut self, deposit: Deposit<'_>) -> io::Result<f64> {
        self.ground.deposit(deposit)
    }
    fn weather(&mut self, cell: usize, amount: f64, cause: &str) -> io::Result<()> {
        self.ground.weather(cell, amount, cause)
    }
    fn weather_by(
        &mut self,
        cell: usize,
        forcing: &Forcing,
        power: f64,
        cause: &str,
    ) -> io::Result<()> {
        self.ground.weather_by(cell, forcing, power, cause)
    }
    fn raise_from_crust(&mut self, cell: usize, amount: f64, cause: &str) -> io::Result<()> {
        self.ground.raise_from_crust(cell, amount, cause)
    }
    fn remember(&mut self, name: &str, cell: usize, amount: f64) -> io::Result<()> {
        let field = Scalar::named(name)
            .ok_or_else(|| io::Error::other(format!("Unknown shared history channel {name}")))?;
        let band = self.shared.scalar_mut(field);
        band.set(cell, band.get(cell)? + amount)
    }
    fn produced(&mut self, volume: f64) {
        StageGround::produced(self.ground, volume);
    }
}
impl Field {
    /// A process submits its requests inside one opaque operation; settlement alone changes material.
    pub fn stage_command<P: 'static>(
        id: &str,
        kind: CommandKind,
        dependencies: Vec<QueryDependency<Self>>,
        sharing: Sharing,
        submit: impl Fn(&mut Stage<'_, FieldGround<'_>>, &P, &QueryValues) -> io::Result<()> + 'static,
    ) -> Command<Self, P> {
        Self::stage_command_with_roots(id, kind, dependencies, sharing, None, submit)
    }
    pub fn stage_command_with_roots<P: 'static>(
        id: &str,
        kind: CommandKind,
        dependencies: Vec<QueryDependency<Self>>,
        sharing: Sharing,
        root_hold: Option<Query<Self, AnswerBand>>,
        submit: impl Fn(&mut Stage<'_, FieldGround<'_>>, &P, &QueryValues) -> io::Result<()> + 'static,
    ) -> Command<Self, P> {
        Self::stage_command_with_preparation(
            id,
            kind,
            dependencies,
            sharing,
            StagePreparation {
                root_hold,
                commands: vec![],
            },
            submit,
        )
    }
    pub fn stage_command_with_preparation<P: 'static>(
        id: &str,
        kind: CommandKind,
        mut dependencies: Vec<QueryDependency<Self>>,
        sharing: Sharing,
        prepare: StagePreparation<P>,
        submit: impl Fn(&mut Stage<'_, FieldGround<'_>>, &P, &QueryValues) -> io::Result<()> + 'static,
    ) -> Command<Self, P> {
        let StagePreparation {
            root_hold,
            commands,
        } = prepare;
        if let Some(query) = &root_hold {
            dependencies.push(query.dependency());
        }
        Command::with_inputs(id, kind, dependencies, move |context, input| {
            // All coupled answers resolve first. Preparations refresh derived routes before
            // settlement borrows the material owner; none of the stage's removals have landed.
            for command in &commands {
                context.run(command, input)?;
            }
            // Capture dependencies before borrowing any owner writer.
            let (state, values) = context.parts();
            let roots = root_hold
                .as_ref()
                .map(|query| values.get(query))
                .transpose()?;
            let result = (|| {
                let water = state.water();
                let mut ground = state.ground.try_borrow_mut().map_err(io::Error::other)?;
                if let Some(roots) = &roots {
                    ground.root_hold(Some(roots.values()));
                }
                let coverage = state.coverage.get_mut();
                let mut owner = FieldGround {
                    ground: &mut ground,
                    shared: &mut state.shared,
                    water,
                };
                let mut stage = Stage::new(
                    &mut owner,
                    coverage,
                    &state.mesh,
                    &mut state.ground_load,
                    sharing,
                );
                submit(&mut stage, input, values)?;
                stage.settle().map(|_| ())
            })();
            result.map_err(|error| ExecutionError::Failed(error.to_string()))
        })
    }
}
