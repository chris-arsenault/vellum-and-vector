use crate::{
    atlas::{environment::Environment, magic, state::State},
    execution::{Executor, Projection, Query},
    field::{ecology, Field},
};

pub struct Reads {
    pub ocean: Query<State, ()>,
    pub media: Query<State, ()>,
    pub magic: Query<State, ()>,
    pub climate: Query<State, ()>,
    pub water: Query<State, ()>,
    pub habitats: Query<State, ()>,
    pub landforms: Query<State, ()>,
    pub refresh: Query<State, ()>,
    ecology: Query<State, ()>,
    validation: Query<State, ()>,
}
impl Reads {
    pub fn new(
        environment: &Environment,
        magic: &magic::Operations,
        validation: &Query<Field, ()>,
        field: &Projection<State, Field>,
    ) -> Self {
        let surface = environment.ocean.projected(field);
        let ocean = Query::new(
            "refinement.ocean",
            vec![surface.dependency()],
            |_, _| Ok(()),
        );
        let distance = environment.distance.projected(field);
        let media = Query::new(
            "refinement.media",
            vec![ocean.dependency()],
            move |state: &State, read| {
                state.update_regional_slopes()?;
                if state
                    .regional
                    .as_ref()
                    .is_some_and(|region| region.network.is_some())
                {
                    read.get(&distance)?;
                    state.refresh_regional_media()?;
                }
                Ok(())
            },
        );
        let coast = magic.coast.clone();
        let magic = Query::new(
            "refinement.magic-refresh",
            vec![media.dependency()],
            move |state: &State, read| {
                if state
                    .regional
                    .as_ref()
                    .is_some_and(|region| region.domains.iter().any(|domain| domain == "magic"))
                    && state.physical.magic.is_some()
                {
                    read.get(&coast)?;
                }
                Ok(())
            },
        );
        let climate = Query::new(
            "refinement.climate",
            vec![media.dependency(), magic.dependency()],
            |state: &State, _| {
                state.respond_regional_climate()?;
                Ok(())
            },
        );
        let rivers = environment.rivers.projected(field);
        let water = Query::new(
            "refinement.water",
            vec![climate.dependency()],
            move |_, read| {
                read.get(&rivers)?;
                Ok(())
            },
        );
        let ecology = ecology::classify_child(
            [
                &environment.atmosphere,
                &environment.bathymetry,
                &environment.river_heat,
                &environment.floodplains,
                &environment.deltas,
            ]
            .into_iter()
            .map(Query::dependency)
            .collect(),
        )
        .projected(field);
        let classification = ecology.clone();
        let habitats = Query::new(
            "refinement.ecology-present",
            vec![climate.dependency(), water.dependency()],
            move |_, read| {
                read.get(&classification)?;
                Ok(())
            },
        );
        let classification = environment.landforms.projected(field);
        let landforms = Query::new(
            "refinement.landforms",
            vec![media.dependency(), water.dependency()],
            move |state: &State, read| {
                state.derive_regional_divides()?;
                read.get(&classification)?;
                state.mark_place_landforms()
            },
        );
        let validation = validation.projected(field);
        let final_check = validation.clone();
        let refresh = Query::new(
            "refinement.refresh",
            vec![landforms.dependency(), habitats.dependency()],
            move |_, read| {
                read.get(&final_check)?;
                Ok(())
            },
        );
        Self {
            ocean,
            media,
            magic,
            climate,
            water,
            habitats,
            landforms,
            refresh,
            ecology,
            validation,
        }
    }
    pub fn select(&self, executor: &mut Executor<State>) {
        for query in [
            &self.ocean,
            &self.media,
            &self.magic,
            &self.climate,
            &self.water,
            &self.habitats,
            &self.landforms,
            &self.refresh,
            &self.ecology,
            &self.validation,
        ] {
            executor.select(query);
        }
    }
}
