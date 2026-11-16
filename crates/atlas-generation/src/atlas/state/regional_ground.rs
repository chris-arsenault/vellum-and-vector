use super::State;
use crate::{
    execution::{Command, CommandKind, ExecutionResult},
    field::{
        poi::ground_reads,
        refinement::{
            causes::Registry, character::Character, columns::ParentContacts, network::Captured,
            proposal::Proposal,
        },
        Field,
    },
    hpc::BitSet,
    reconstruction::Grid,
    rock::ground::contacts::Plan,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::ReadBand,
};
use std::{cell::RefCell, io};

struct Columns<'a> {
    input: &'a ParentContacts<'a>,
    output: RefCell<Vec<Plan>>,
}
struct Ground<'a> {
    donor: &'a Grid,
    area: &'a [f64],
    receiver: &'a [i32],
    retained: &'a BitSet,
    contacts: &'a [Plan],
    root_hold: ReadBand<f64>,
}
fn ground_operation<'a>() -> Command<Field, Ground<'a>> {
    Command::with_inputs(
        "regional.start-ground",
        CommandKind::Initialize,
        vec![],
        |scope, work: &Ground<'_>| {
            let field = scope.state_mut();
            field.place_inherited_valleys(
                work.donor,
                work.area,
                work.receiver,
                work.retained,
                work.root_hold.clone(),
            )?;
            field.realize_inherited_columns(work.contacts)?;
            Ok(())
        },
    )
}
impl State {
    pub fn derive_regional_character(&mut self) -> io::Result<()> {
        let regional = self.require_regional()?;
        let character = Character::derive(
            self.field(),
            &regional.inherited_height,
            regional.parent_span,
        )?;
        self.regional.as_mut().unwrap().character = Some(character);
        Ok(())
    }
    pub fn prepare_regional_columns(&mut self, parent: ParentContacts<'_>) -> ExecutionResult<()> {
        self.require_regional()?;
        let operation: Command<Field, Columns<'_>> = Command::with_inputs(
            "regional.prepare-columns",
            CommandKind::Initialize,
            vec![],
            |scope, work: &Columns<'_>| {
                let p = work.input;
                *work.output.borrow_mut() =
                    scope
                        .state_mut()
                        .prepare_inherited_columns(ParentContacts {
                            grid: p.grid,
                            count: p.count,
                            bedrock: p.bedrock,
                            share: p.share,
                            depth: p.depth,
                        })?;
                Ok(())
            },
        );
        let work = Columns {
            input: &parent,
            output: RefCell::default(),
        };
        self.physical.executor.run_with(&operation, &work)?;
        self.regional.as_mut().unwrap().contacts = work.output.into_inner();
        Ok(())
    }
    pub fn grow_regional_network(
        &mut self,
        causes: &Registry<Self>,
        seed: i32,
        withdrawal: ReadBand<f64>,
        transmission: ReadBand<f64>,
        root_hold: ReadBand<f64>,
    ) -> io::Result<()> {
        let regional = self.require_regional()?;
        let field = self.field();
        let datum = MapScale::metres(field.water().effective_sea_level, LengthUnit::Native);
        let base = field.smoothed_captured_base(
            &regional.inherited_height,
            regional.parent_span,
            datum,
            seed,
        )?;
        let mut costs = vec![1.0; field.mesh().len()];
        causes.influence(self, &mut costs)?;
        let mut ocean = Vec::with_capacity(costs.len());
        let mut inherited = Vec::with_capacity(costs.len());
        let mut retained = Vec::with_capacity(costs.len());
        let mut closed = Vec::with_capacity(costs.len());
        for cell in 0..costs.len() {
            ocean.push(u8::from(field.water().column.kind.get(cell)? == 1));
            inherited.push(regional.inherited_height.get(cell)?);
            retained.push(u8::from(field.has_retained_river(cell)));
            closed.push(u8::from(ground_reads::closed_by_aridity(self, cell)?));
        }
        let character = regional
            .character
            .as_ref()
            .ok_or_else(|| io::Error::other("Read captured character before growing a network"))?;
        let network = field.captured_network(
            base,
            Proposal {
                captured: Captured {
                    ocean: &ocean,
                    lakes: &regional.evidence.lakes,
                    entries: &regional.evidence.entries,
                    inherited: &inherited,
                    datum,
                    retained_river: &retained,
                    span: field.scale().cells(1.0),
                    basin_depth: field
                        .scale()
                        .resolve(RelativeMeasure::length(0.000005).map_err(io::Error::other)?)
                        .map_err(io::Error::other)?
                        .value(),
                },
                cones: &character.cones,
                costs: &costs,
                closed: &closed,
                withdrawal,
                transmission,
                open_bed_seepage: self.physical.settings.relief.open_bed_seepage,
                root_hold,
            },
        )?;
        self.regional.as_mut().unwrap().network = Some(network);
        Ok(())
    }
    pub fn start_regional_ground(
        &mut self,
        donor: &Grid,
        causes: &Registry<Self>,
        root_hold: ReadBand<f64>,
    ) -> ExecutionResult<()> {
        let regional = self.regional.as_ref().ok_or_else(|| {
            io::Error::other("Initialize regional context before starting ground")
        })?;
        let network = regional
            .network
            .as_ref()
            .ok_or_else(|| io::Error::other("Grow the captured network before starting ground"))?;
        let mut retained = BitSet::new(self.field().mesh().len());
        for cell in 0..self.field().mesh().len() {
            if self.field().has_retained_river(cell) {
                retained.add(cell);
            }
        }
        let basin = network.basin_mask();
        self.physical.executor.run_with(
            &ground_operation(),
            &Ground {
                donor,
                area: &network.area,
                receiver: &network.tree.receiver,
                retained: &retained,
                contacts: &regional.contacts,
                root_hold,
            },
        )?;
        let regional = self.regional.as_mut().unwrap();
        regional.contacts.clear();
        regional.basin = Some(basin);
        causes.restore(self)?;
        self.update_regional_slopes()?;
        Ok(())
    }
    pub fn update_regional_slopes(&self) -> io::Result<()> {
        self.field().regional_slopes()
    }
}
