//! Executable sea, sky, ice and water dependencies from the current process definitions.
use crate::{
    answers::{AnswerBand, QuestionBinding, QuestionBook},
    bindings::physical_seeds,
    execution::{Command, ExecutionResult, Executor, Query, QueryDependency, Selection},
    field::{
        self, climate, geography, glaciers, landforms, sea_ice, warmth,
        water::{
            self, channels, deltas, drainage, network, transfers, OceanBudget, WaterOperations,
        },
        Field,
    },
    processes::runner::PhysicalContext,
    scale_settings::ResolvedSettings,
    storage::ReadBand,
    water::runoff::RunoffView,
};
use std::{io, rc::Rc};

pub type Questions = QuestionBinding<Field, &'static str>;
type BoundaryDistance = Rc<dyn Fn(usize) -> io::Result<f64>>;
pub struct Environment {
    pub ocean_budget: Command<Field, PhysicalContext>,
    pub ocean: Query<Field, ()>,
    pub ocean_memory: Command<Field, PhysicalContext>,
    pub distance: Query<Field, ReadBand<f64>>,
    pub bathymetry: Query<Field, ()>,
    pub currents: Query<Field, ()>,
    pub geothermal: Query<Field, ReadBand<f64>>,
    pub warmth: Query<Field, ()>,
    pub atmosphere: Query<Field, ()>,
    pub sea_ice: Command<Field, PhysicalContext>,
    pub water_transfer: Command<Field, PhysicalContext>,
    pub runoff: Query<Field, RunoffView>,
    pub meltwater: Query<Field, ()>,
    pub groundwater: Command<Field, PhysicalContext>,
    pub conditioning: Query<Field, ()>,
    pub lakes: Query<Field, ()>,
    pub guidance: Query<Field, ()>,
    pub routing: Query<Field, ()>,
    pub river_evolution: Command<Field, network::RiverEvolution>,
    pub rivers: Query<Field, ()>,
    pub channels: Query<Field, ()>,
    pub river_heat: Query<Field, ()>,
    pub floodplains: Query<Field, ()>,
    pub deltas: Query<Field, ()>,
    pub land_ice: Command<Field, PhysicalContext>,
    pub ice_flow: Command<Field, PhysicalContext>,
    pub glacial_landforms: Query<Field, ReadBand<i32>>,
    pub landforms: Query<Field, ()>,
    pub landmasses: Query<Field, ()>,
    pub dams: Query<Field, ReadBand<u8>>,
    pub root_hold: Query<Field, AnswerBand>,
    pub surface_water: Query<Field, AnswerBand>,
    pub withdrawal: Query<Field, AnswerBand>,
    pub transmission: Query<Field, AnswerBand>,
    pub soil_wetting: Query<Field, AnswerBand>,
    pub soil_held: Query<Field, AnswerBand>,
    pub sea_stand: Query<Field, AnswerBand>,
}
fn optional<T: crate::execution::QueryValue>(query: &Query<Field, T>) -> QueryDependency<Field> {
    query.optional_dependency()
}
pub(super) fn select_query<T: crate::execution::QueryValue>(
    executor: &mut Selection<'_, Field>,
    query: &Query<Field, T>,
    seed: i32,
    chosen: &impl Fn(&str) -> Option<i32>,
) {
    if let Some(salt) = chosen(query.name()) {
        executor.select_with_input(query, move |input: &PhysicalContext| {
            let seeds = physical_seeds(seed, salt, input.epoch_index);
            PhysicalContext {
                seed: seeds.seed,
                epoch_stable_seed: seeds.epoch_stable_seed,
                span: 0.0,
                local_development: Some(false),
                ..*input
            }
        });
    }
}
fn number(settings: &ResolvedSettings, key: &str) -> io::Result<f64> {
    settings
        .values()
        .get(key)
        .and_then(serde_json::Value::as_f64)
        .ok_or_else(|| io::Error::other(format!("Physical profile requires {key}")))
}
impl Environment {
    pub fn new(
        settings: &ResolvedSettings,
        questions: &Questions,
        open_boundary: bool,
        boundary_distance: Option<BoundaryDistance>,
    ) -> io::Result<Self> {
        let ask = |key| Field::bound_question(questions, key, key);
        let root_hold = ask("rootHold");
        let surface_water = ask("surfaceWater");
        let withdrawal = ask("waterWithdrawal");
        let transmission = ask("waterTransmission");
        let soil_wetting = ask("soilWetting");
        let soil_held = ask("soilWaterHeld");
        let sea_stand = ask("seaStand");
        let climate = Rc::new(climate::settings::Settings::from_resolved(settings)?);
        let glacier = Rc::new(glaciers::Settings::from_resolved(settings)?);
        let transfers = Rc::new(transfers::Settings::from_resolved(settings)?);
        let drainage = Rc::new(drainage::Settings::from_resolved(settings)?);
        let network = Rc::new(network::Settings::from_resolved(settings)?);
        let channel = Rc::new(channels::Settings::from_resolved(settings)?);
        let geography = Rc::new(geography::Settings::from_resolved(settings)?);
        let coverage = settings
            .values()
            .pointer("/QualityTargets/OceanCoverage/target")
            .and_then(serde_json::Value::as_f64)
            .ok_or_else(|| io::Error::other("Ocean formation requires its configured coverage"))?;
        let ocean_budget = Field::ocean_budget(OceanBudget {
            coverage,
            sea_level: number(settings, "SeaLevel")?,
            elevation_scale: number(settings, "ElevationScale")?,
        });
        let ocean = Field::ocean_surface(sea_stand.clone());
        let ocean_memory = Field::marine_reconnection(vec![optional(&ocean)]);
        let distance = Field::ocean_distance(vec![optional(&ocean)], boundary_distance);
        let bathymetry = Field::bathymetry(
            geography.clone(),
            vec![optional(&ocean), optional(&distance)],
        );
        let currents = Field::ocean_currents(
            Rc::new(climate::currents::settings::Settings::from_resolved(
                settings,
            )?),
            vec![optional(&ocean)],
        );
        let geothermal =
            Field::geothermal(field::crust_settings::Settings::from_resolved(settings)?);
        let warmth = Field::warmth_sources(
            warmth::Settings::from_resolved(settings)?,
            vec![
                optional(&distance),
                optional(&currents),
                optional(&geothermal),
            ],
        );
        let atmosphere = Field::atmospheric_climate(
            climate.clone(),
            vec![optional(&ocean), optional(&distance), optional(&warmth)],
        );
        let sea_ice = Field::sea_ice(
            sea_ice::Settings::from_resolved(settings)?,
            vec![optional(&ocean), optional(&atmosphere)],
        );
        let water_transfer = Field::water_column_transfer(
            transfers.clone(),
            climate.clone(),
            transfers::SoilQuestions {
                wetting: soil_wetting.clone(),
                held: soil_held.clone(),
            },
            vec![optional(&ocean), optional(&atmosphere)],
        );
        let runoff = WaterOperations::new().runoff;
        let meltwater = Field::glacial_meltwater(
            transfers,
            vec![
                optional(&ocean),
                optional(&atmosphere),
                optional(&geothermal),
                optional(&runoff),
            ],
        );
        let groundwater =
            Field::groundwater_transfer(vec![optional(&ocean), optional(&atmosphere)]);
        let conditioning = Field::drainage_conditioning(
            drainage.clone(),
            open_boundary,
            root_hold.clone(),
            vec![optional(&ocean)],
        );
        let network_questions = network::Questions {
            surface_water: surface_water.clone(),
            withdrawal: withdrawal.clone(),
            transmission: transmission.clone(),
        };
        let dams = field::people::waterworks::dams();
        let lakes = Field::lake_basins(
            network.clone(),
            climate.clone(),
            network_questions.clone(),
            Some(dams.clone()),
            vec![optional(&runoff), optional(&conditioning)],
        );
        let landmasses = Field::landmasses(geography, vec![optional(&lakes)]);
        let guidance = Field::drainage_guidance(
            drainage,
            open_boundary,
            root_hold.clone(),
            vec![optional(&lakes)],
        );
        let routing = Field::flow_routing(open_boundary, vec![optional(&guidance)]);
        let rivers = Field::river_network(
            network.clone(),
            climate.clone(),
            network_questions.clone(),
            vec![optional(&runoff), optional(&routing)],
        );
        let river_evolution = Field::river_evolution(
            network,
            climate,
            network_questions,
            vec![optional(&runoff), optional(&routing)],
        );
        let channels = Field::river_channel_geometry(channel.clone(), vec![optional(&rivers)]);
        let river_heat = Field::river_heat(vec![optional(&rivers)]);
        let floodplains = Field::floodplains(channel, vec![optional(&channels)]);
        let deltas = Field::delta_formation(
            Rc::new(deltas::Settings::from_resolved(settings)?),
            vec![
                optional(&floodplains),
                optional(&currents),
                optional(&bathymetry),
            ],
        );
        let land_ice = Field::land_ice(
            glacier.clone(),
            vec![
                optional(&ocean),
                optional(&atmosphere),
                optional(&geothermal),
            ],
        );
        let ice_flow = Field::ice_flow(glacier.clone(), vec![optional(&ocean)]);
        let glacial_landforms =
            Field::glacial_landforms(glacier, vec![optional(&ocean), optional(&rivers)]);
        let landforms = Field::landform_classification(
            Rc::new(landforms::Settings::from_resolved(settings)?),
            vec![
                optional(&rivers),
                optional(&glacial_landforms),
                optional(&deltas),
            ],
        );
        Ok(Self {
            ocean_budget,
            ocean,
            ocean_memory,
            distance,
            bathymetry,
            currents,
            geothermal,
            warmth,
            atmosphere,
            sea_ice,
            water_transfer,
            runoff,
            meltwater,
            groundwater,
            conditioning,
            lakes,
            guidance,
            routing,
            river_evolution,
            rivers,
            channels,
            river_heat,
            floodplains,
            deltas,
            land_ice,
            ice_flow,
            glacial_landforms,
            landforms,
            landmasses,
            dams,
            root_hold,
            surface_water,
            withdrawal,
            transmission,
            soil_wetting,
            soil_held,
            sea_stand,
        })
    }
    /// Selection comes from the executable operations chosen by the map's feature profile.
    pub fn select(
        &self,
        executor: &mut Executor<Field>,
        seed: i32,
        chosen: impl Fn(&str) -> Option<i32>,
    ) {
        self.select_in(&mut executor.selection(), seed, chosen);
    }
    pub fn select_in(
        &self,
        executor: &mut Selection<'_, Field>,
        seed: i32,
        chosen: impl Fn(&str) -> Option<i32>,
    ) {
        macro_rules! selected { ($($field:ident),+ $(,)?) => { $(select_query(executor, &self.$field, seed, &chosen);)+ }; }
        selected!(
            ocean,
            distance,
            bathymetry,
            currents,
            geothermal,
            warmth,
            atmosphere,
            runoff,
            meltwater,
            conditioning,
            lakes,
            guidance,
            routing,
            rivers,
            channels,
            river_heat,
            floodplains,
            deltas,
            glacial_landforms,
            landforms,
            landmasses
        );
        // Shared questions always exist; only selected physical providers refresh their fields.
        macro_rules! question { ($($field:ident),+ $(,)?) => { $(executor.select(&self.$field);)+ }; }
        question!(
            root_hold,
            surface_water,
            withdrawal,
            transmission,
            soil_wetting,
            soil_held,
            sea_stand,
            dams
        );
    }
    pub fn respond(
        &self,
        book: &mut QuestionBook<Field, &'static str>,
        reference_runoff: f64,
    ) -> ExecutionResult<()> {
        water::respond(
            book,
            optional(&self.runoff),
            optional(&self.meltwater),
            reference_runoff,
        )?;
        climate::respond(
            book,
            optional(&self.atmosphere),
            optional(&self.currents),
            reference_runoff,
        )
    }
}
