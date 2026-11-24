//! Operations from regional/schedule.ts; selected feature contributions determine their order.
use super::{context, development, people, queries::Reads};
use crate::{
    atlas::{
        context::EcologyEpoch, environment::Environment, magic, parameters::AtlasParameters,
        state::State,
    },
    ecology::lifecycle::Authority,
    execution::{Command, CommandKind, ExecutionResult, Projection},
    field::{
        people::era_places,
        poi::{carry::Outcomes, publication::Publication},
        refinement::{causes::Registry, people::PlaceSettings},
        schema::NumericBand,
        Field,
    },
    processes::runner::PhysicalContext,
    reconstruction::Grid,
};
use std::{cell::RefCell, rc::Rc};

// Arconis: docs/architecture/subsystems.arconis#item=rg_ground — holds the captured ground and relief, built once.
pub struct CapturedGround {
    pub grid: Rc<Grid>,
    pub bedrock: NumericBand,
    pub share: NumericBand,
    pub depth: NumericBand,
    pub has_small_channels: bool,
}
pub struct People {
    pub record: Command<Field, era_places::Setting>,
    pub settings: PlaceSettings,
}
pub type Progress = Rc<dyn Fn(f64, &str)>;
pub struct Inputs {
    pub seed: i32,
    pub captured: CapturedGround,
    pub causes: Registry<State>,
    pub publication: Rc<RefCell<Publication>>,
    pub outcomes: RefCell<Outcomes>,
    pub parameters: AtlasParameters,
    pub ecology: EcologyEpoch,
    pub authority: Authority,
    pub people: People,
    pub progress: Progress,
}
pub struct Occurrence {
    pub physical: PhysicalContext,
    pub round: usize,
    pub people: bool,
}
pub type Operation = Command<State, Occurrence>;
pub struct Work {
    pub clear: Operation,
    pub context: Operation,
    pub round: Operation,
    pub relief: Operation,
    pub water_initialize: Operation,
    pub water_evolution: Operation,
    pub ocean_memory: Operation,
    pub magic_react: Operation,
    pub magic_transport: Operation,
    pub magic_water: Operation,
    pub magic_organic: Operation,
    pub ecology_initialize: Operation,
    pub ecology_develop: Operation,
    pub place_effects: Operation,
    /// City growth on a city map (`regional/city`); a no-op elsewhere.
    pub city_walls: Operation,
    /// Major works sited in the city.
    pub city_works: Operation,
    pub magic_map: Operation,
    pub identity: Operation,
    pub places: Operation,
    /// Caves beneath a real-scale ground map (`processes/caves`).
    pub caves: Operation,
}
pub(super) fn command(
    name: &str,
    kind: CommandKind,
    dependencies: Vec<crate::execution::QueryDependency<State>>,
    apply: impl Fn(&mut State, &Occurrence) -> ExecutionResult<()> + 'static,
) -> Operation {
    Command::with_inputs(
        format!("refinement.{name}"),
        kind,
        dependencies,
        move |scope, input| {
            let state = scope.state_mut();
            state.clear_queries();
            let result = apply(state, input);
            state.clear_queries();
            result
        },
    )
}
impl Work {
    pub fn new(
        input: Rc<Inputs>,
        environment: Rc<Environment>,
        reads: &Reads,
        magic: &magic::Operations,
        field: &Projection<State, Field>,
    ) -> Self {
        let clear = command(
            "clear-products",
            CommandKind::Publish,
            vec![],
            |state, _| {
                state.clear_regional_products()?;
                Ok(())
            },
        );
        let context = context::prepare(input.clone(), &environment, field);
        let relief = context::relief(input.clone(), &environment, field);
        let round_input = input.clone();
        let round = command("round", CommandKind::Event, vec![], move |state, step| {
            state.begin_regional_round(&round_input.causes, step.round)?;
            Ok(())
        });
        let water_initialize =
            development::water(input.clone(), environment.clone(), reads, field, true);
        let water_evolution =
            development::water(input.clone(), environment.clone(), reads, field, false);
        let ocean = environment.ocean_memory.projected(field);
        let ocean_memory = Command::with_inputs(
            "refinement.ocean-memory",
            CommandKind::Event,
            vec![reads.ocean.dependency()],
            move |scope, step: &Occurrence| scope.run(&ocean, &step.physical),
        );
        let seed = input.seed;
        let magic_react = command(
            "magic-react",
            CommandKind::Work,
            vec![reads.magic.dependency()],
            move |state, _| state.react_regional_magic(seed, 1.0),
        );
        let magic_transport = command(
            "magic-transport",
            CommandKind::Event,
            vec![reads.water.dependency()],
            |state, _| state.transport_retained_magic(),
        );
        let magic_water = command(
            "magic-water",
            CommandKind::Event,
            vec![reads.water.dependency()],
            |state, _| state.exchange_magic_water(),
        );
        let magic_organic = command("magic-organic", CommandKind::Event, vec![], |state, _| {
            state.respond_regional_organic()
        });
        let ecology_initialize = command(
            "ecology-initialize",
            CommandKind::Initialize,
            vec![],
            move |state, _| state.prepare_regional_ecology(seed),
        );
        let ecology_develop = development::ecology(input.clone(), environment, reads, field);
        let place_effects = people::effects(input.clone(), reads, field);
        let city_walls = super::city::walls(input.clone());
        let city_works = super::city::works_step(input.clone());
        let places = people::publish(input.clone(), reads, field);
        let caves = command(
            "caves",
            CommandKind::Publish,
            vec![reads.water.dependency()],
            |state, _| Ok(state.publish_caves()?),
        );
        let publish_magic = magic.project.clone();
        let magic_map = Command::with_inputs(
            "refinement.magic-map",
            CommandKind::Publish,
            vec![
                reads.magic.dependency(),
                reads.climate.dependency(),
                reads.water.dependency(),
            ],
            move |scope, _: &Occurrence| scope.run(&publish_magic, &()),
        );
        let identity = command(
            "identity",
            CommandKind::Publish,
            vec![reads.landforms.dependency()],
            move |state, _| {
                state.carry_regional_identities()?;
                state.carry_places(
                    &mut input.publication.borrow_mut(),
                    &mut input.outcomes.borrow_mut(),
                )?;
                Ok(())
            },
        );
        Self {
            clear,
            context,
            round,
            relief,
            water_initialize,
            water_evolution,
            ocean_memory,
            magic_react,
            magic_transport,
            magic_water,
            magic_organic,
            ecology_initialize,
            ecology_develop,
            place_effects,
            city_walls,
            city_works,
            magic_map,
            identity,
            places,
            caves,
        }
    }
}
