//! Tectonic and material operations use the same physical providers as the water graph.
use super::environment::{select_query, Environment, Questions};
use crate::{
    answers::{AnswerBand, QuestionBook},
    execution::{Command, ExecutionResult, Executor, Query, Selection},
    field::{self, advection, crust_settings, glaciers, sediment::PassageQuestions, Field},
    processes::{
        coast, creep, fluvial, ice, marine_sediment, rock_history,
        runner::{self, PhysicalContext},
        slopes, solution, streams, weathering,
    },
    scale_settings::ResolvedSettings,
    spatial::SpatialKernel,
    storage::ReadBand,
    transport::carriers::Carriers,
};
use std::{io, rc::Rc};

pub struct TerrainContext {
    pub passes: f64,
    pub refined: bool,
    pub open_boundary: bool,
}
pub struct Terrain {
    pub support: Query<Field, ReadBand<f64>>,
    pub domains: Query<Field, ReadBand<f64>>,
    pub coastal_forcing: Query<Field, ()>,
    pub provinces: Command<Field, i32>,
    pub uplift: Command<Field, PhysicalContext>,
    pub landscape: Command<Field, i32>,
    pub plumes: Command<Field, PhysicalContext>,
    pub epoch_activity: Command<Field>,
    pub sutures: Command<Field, PhysicalContext>,
    pub margins: Command<Field, PhysicalContext>,
    pub mountains: Command<Field, PhysicalContext>,
    pub relaxation: Command<Field, PhysicalContext>,
    pub volcanoes: Command<Field, PhysicalContext>,
    pub impacts: Command<Field, PhysicalContext>,
    pub fractures: Command<Field, PhysicalContext>,
    pub flexure: Command<Field>,
    pub shore_detail: Command<Field, PhysicalContext>,
    pub margin_evolution: Command<Field>,
    pub fluvial_erosion: Command<Field, PhysicalContext>,
    pub mass_wasting: Command<Field, PhysicalContext>,
    pub post_fluvial_slopes: Command<Field, PhysicalContext>,
    pub glacial_erosion: Command<Field, PhysicalContext>,
    pub glacial_deposition: Command<Field, PhysicalContext>,
    pub coastal_erosion: Command<Field, PhysicalContext>,
    pub outside_waves: Command<Field, PhysicalContext>,
    pub sediment: fluvial::Operations,
    pub sea_floor: Command<Field>,
    pub burial: Command<Field, PhysicalContext>,
    pub baking: Command<Field>,
    pub epoch_record: Command<Field, PhysicalContext>,
    questions: Vec<Query<Field, AnswerBand>>,
}
impl Terrain {
    pub fn new(
        profile: &ResolvedSettings,
        questions: &Questions,
        environment: &Environment,
        spatial: Rc<dyn SpatialKernel>,
        context: TerrainContext,
    ) -> io::Result<Self> {
        let TerrainContext {
            passes,
            refined,
            open_boundary,
        } = context;
        let ask = |key| Field::bound_question(questions, key, key);
        let wetness = ask("wetness");
        let warmth = ask("warmth");
        let frost = ask("frost");
        let discharge = ask("discharge");
        let capacity = ask("loadCapacity");
        let bite = ask("iceBite");
        let waves = ask("waveEnergy");
        let forcing = ask("coastalForcing");
        let heat = ask("heat");
        let passage = || PassageQuestions {
            discharge: discharge.clone(),
            withdrawal: environment.withdrawal.clone(),
            transmission: environment.transmission.clone(),
        };
        let roots = &environment.root_hold;
        let crust = crust_settings::Settings::from_resolved(profile)?;
        let glacier = Rc::new(glaciers::Settings::from_resolved(profile)?);
        let orogeny = Rc::new(field::orogeny::settings::Settings::from_resolved(profile)?);
        let support = Field::crustal_support(crust.clone());
        let domains = Field::continental_domains(crust.clone());
        let fluvial_erosion = runner::together(
            "ancestral-fluvial-erosion",
            vec![
                weathering::process(
                    profile,
                    passes,
                    weathering::Questions {
                        wetness: wetness.clone(),
                        warmth: warmth.clone(),
                        frost: frost.clone(),
                    },
                )?,
                streams::process(
                    profile,
                    Rc::new(field::water::drainage::Settings::from_resolved(profile)?),
                    open_boundary,
                    refined,
                    field::water::streams::Questions {
                        passage: passage(),
                        roots: roots.clone(),
                        conditioning: environment.conditioning.clone(),
                    },
                )?,
                solution::process(profile, passes, wetness.clone())?,
                creep::process(profile, passes)?,
            ],
            roots.clone(),
        );
        let sediment = fluvial::operations(
            profile,
            passage(),
            capacity.clone(),
            vec![environment.rivers.optional_dependency()],
        )?;
        Ok(Self {
            flexure: Field::lithospheric_flexure(crust.clone(), support.clone()),
            uplift: Field::tectonic_uplift(profile, vec![domains.optional_dependency()])?,
            support,
            domains,
            coastal_forcing: Field::coastal_forcing(vec![
                environment.ocean.optional_dependency(),
                environment.currents.optional_dependency(),
            ]),
            provinces: Field::province_layout(spatial, profile)?,
            landscape: Field::first_landscape(),
            plumes: Field::mantle_plume_roots(field::plumes::Settings::from_resolved(profile)?),
            epoch_activity: Field::tectonic_epoch(),
            sutures: Field::continental_sutures(field::sutures::Settings::from_resolved(profile)?),
            margins: Field::tectonic_margins(crust),
            mountains: Field::orogenic_construction(orogeny.clone()),
            relaxation: Field::relax_orogenic_crust(orogeny),
            volcanoes: Field::volcanic_construction(
                field::volcanism::settings::Settings::from_resolved(profile)?,
            ),
            impacts: Field::impact_cratering(Rc::new(
                field::impacts::settings::Settings::from_resolved(profile)?,
            )),
            fractures: Field::fracture_network(Rc::new(
                field::fractures::settings::Settings::from_resolved(profile)?,
            )),
            shore_detail: Field::coastal_detail(field::coastal_detail::Settings::from_resolved(
                profile,
            )?)
            .depending_on([environment.ocean.optional_dependency()]),
            margin_evolution: Field::continental_margin_evolution(vec![environment
                .ocean
                .optional_dependency()]),
            fluvial_erosion,
            mass_wasting: slopes::process("slopes", profile, roots.clone())?,
            post_fluvial_slopes: slopes::process("slopes-after-streams", profile, roots.clone())?,
            glacial_erosion: ice::process(glacier.clone(), bite.clone(), roots.clone()),
            glacial_deposition: Field::glacial_deposition(glacier, vec![]),
            coastal_erosion: coast::process(profile, waves.clone(), roots.clone(), None)?,
            outside_waves: coast::process(
                profile,
                waves.clone(),
                roots.clone(),
                Some(forcing.clone()),
            )?,
            sediment,
            sea_floor: marine_sediment::process(profile)?
                .depending_on([environment.ocean.optional_dependency()]),
            burial: rock_history::lithification()
                .depending_on([environment.lakes.optional_dependency()]),
            baking: rock_history::metamorphism(heat.clone()),
            epoch_record: Field::epoch_history(),
            questions: vec![
                wetness, warmth, frost, discharge, capacity, bite, waves, forcing, heat,
            ],
        })
    }
    pub fn plates(
        &self,
        spatial: Rc<dyn SpatialKernel>,
        drift_per_myr: f64,
        after_step: Option<Command<Field, PhysicalContext>>,
        during_step: Option<Command<Field, PhysicalContext>>,
        carriers: Carriers<Field>,
    ) -> Command<Field, PhysicalContext> {
        Field::plate_advection(
            spatial,
            drift_per_myr,
            advection::Operations {
                province_layout: self.provinces.clone(),
                after_step,
                during_step,
            },
            carriers,
        )
    }
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
        select_query(executor, &self.support, seed, &chosen);
        select_query(executor, &self.domains, seed, &chosen);
        executor.select(&self.coastal_forcing);
        executor.select(&self.sediment.routing);
        for question in &self.questions {
            executor.select(question);
        }
    }
    pub fn respond(
        &self,
        book: &mut QuestionBook<Field, &'static str>,
        sediment_carry: f64,
    ) -> ExecutionResult<()> {
        glaciers::surface::respond(book)?;
        field::sediment::respond(book, sediment_carry)?;
        rock_history::respond(book)?;
        coast::respond(book, self.coastal_forcing.dependency())
    }
}
