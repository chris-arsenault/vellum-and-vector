//! World-level publication and current forcing around the selected field operations.
use super::{
    features::{Catalogue, Selection},
    people::Publication,
    regional::work::Progress,
    state::{Deliveries, GeographicPublication, State},
};
use crate::{
    execution::{Command, CommandKind, Projection},
    features::{geographic_identity::Original, network::NetworkReader, FeatureReader},
    field::{
        absence,
        forcing::{self, Heat},
        projection, Field,
    },
};
use std::{collections::BTreeSet, rc::Rc};

pub struct Sources {
    pub features: Rc<dyn FeatureReader>,
    pub networks: Rc<dyn NetworkReader>,
    pub contracted: BTreeSet<atlas_map::Id>,
}
impl Sources {
    fn original<'a>(&'a self, contracted: &'a dyn Fn(atlas_map::Id) -> bool) -> Original<'a> {
        Original {
            features: self.features.as_ref(),
            networks: self.networks.as_ref(),
            contracted,
        }
    }
}
pub struct Inputs {
    pub domains: Vec<String>,
    pub naming_era: String,
    pub selection: Selection,
    pub inherited_channels: BTreeSet<String>,
    pub publication: Rc<Publication>,
    pub original: Sources,
    pub progress: Progress,
}
fn absent(input: &Inputs) -> BTreeSet<String> {
    let mut absent = Catalogue::default()
        .features
        .iter()
        .filter(|feature| !input.selection.get(feature.id).is_some_and(|s| s.enabled))
        .flat_map(|feature| feature.absent.iter().map(|history| (*history).to_owned()))
        .collect::<BTreeSet<_>>();
    let channels = &input.inherited_channels;
    if channels.contains("Elevation") {
        absent.insert("Fractures".into());
        for (history, carried) in [
            ("Impacts", &["ImpactExcavation"][..]),
            ("VolcanicConstruction", &["VolcanicConstructionHistory"][..]),
            (
                "GlacialEvolution",
                &["CumulativeGlacialErosion", "CumulativeGlacialDeposition"][..],
            ),
            ("CoastalEvolution", &["CumulativeCoastalErosion"][..]),
        ] {
            if !carried.iter().all(|name| channels.contains(*name)) {
                absent.insert(history.into());
            }
        }
    }
    absent
}
pub struct Operations {
    pub prepare: Command<State>,
    pub names: Command<State>,
    pub absent: Command<State>,
    pub epoch: Command<State>,
    pub forcing: Command<State, bool>,
    pub project: Command<State>,
    pub project_forcing: Command<State>,
    pub features: Command<State>,
    pub magic_places: Command<State>,
    pub place_effects: Command<State>,
}
fn project(input: Rc<Inputs>, forcing_only: bool) -> Command<State> {
    let all = projection::channels::physical();
    Command::new(
        if forcing_only {
            "atlas.project-forcing"
        } else {
            "atlas.project"
        },
        CommandKind::Publish,
        vec![],
        move |state: &mut State, _| {
            let physical = &mut state.physical;
            physical.surface.project(
                physical.executor.state(),
                projection::Selection {
                    forcing_only,
                    physical: if forcing_only {
                        &all
                    } else {
                        &input.publication.physical
                    },
                    derived: Some(&input.publication.derived),
                },
            )?;
            Ok(())
        },
    )
}
impl Operations {
    pub fn new(input: Rc<Inputs>, projection: &Projection<State, Field>) -> Self {
        let prepare_input = input.clone();
        let prepare = Command::new(
            "atlas.prepare",
            CommandKind::Initialize,
            vec![],
            move |state: &mut State, _| {
                super::records::prepare(state, &prepare_input.domains)?;
                Ok(())
            },
        );
        let name_input = input.clone();
        let names = Command::new(
            "atlas.names",
            CommandKind::Publish,
            vec![],
            move |state: &mut State, _| {
                super::records::finalize(
                    state,
                    &name_input.original,
                    &name_input.publication.places.borrow(),
                    &name_input.naming_era,
                )?;
                Ok(())
            },
        );
        let absent = absence::initialize(absent(&input)).projected(projection);
        let epoch = Command::new(
            "atlas.begin-epoch",
            CommandKind::Event,
            vec![],
            |state: &mut State, _| state.begin_epoch(),
        );
        let forcing = Command::with_inputs(
            "atlas.forcing",
            CommandKind::Event,
            vec![],
            |scope, include: &bool| {
                let state: &mut State = scope.state_mut();
                let physical = &mut state.physical;
                let magic = physical
                    .magic
                    .as_ref()
                    .map(|magic| magic.borrow().forcing.heat.read_only());
                physical.executor.run_with(
                    &forcing::replace_heat(),
                    &Heat {
                        surface: &physical.surface,
                        include_standalone: *include,
                        magic,
                    },
                )
            },
        );
        let project = project(input.clone(), false);
        let project_forcing = self::project(input.clone(), true);
        let geography = input.clone();
        let features = Command::new(
            "atlas.features",
            CommandKind::Publish,
            vec![],
            move |state: &mut State, _| {
                let enabled = |id| geography.selection.get(id).is_some_and(|s| s.enabled);
                let contracted = |id: atlas_map::Id| geography.original.contracted.contains(&id);
                let original = geography.original.original(&contracted);
                state.finish_geography(
                    GeographicPublication {
                        deliveries: Deliveries {
                            oceans: enabled("ocean.geography"),
                            impacts: enabled("physical.impacts"),
                            volcanism: enabled("physical.volcanism"),
                            fractures: enabled("physical.fractures"),
                            lakes: enabled("water.routing"),
                            landforms: enabled("physical.landforms"),
                            ecology: enabled("ecology.living"),
                            rivers: enabled("physical.river-networks"),
                            landmarks: enabled("physical.landmarks"),
                        },
                        publication: &mut geography.publication.places.borrow_mut(),
                        landmarks: &geography.publication.landmarks,
                        original: &original,
                    },
                    |part, message| (geography.progress)(part, message),
                )?;
                Ok(())
            },
        );
        let magic_places = Command::new(
            "atlas.magic-places",
            CommandKind::Publish,
            vec![],
            move |state: &mut State, _| {
                let contracted = |id: atlas_map::Id| input.original.contracted.contains(&id);
                let original = input.original.original(&contracted);
                state.finish_magic_places(
                    &mut input.publication.places.borrow_mut(),
                    &original,
                    |part, message| (input.progress)(part, message),
                )?;
                Ok(())
            },
        );
        let place_effects = Command::new(
            "poi.effects",
            CommandKind::Event,
            vec![],
            |state: &mut State, _| {
                state.apply_place_effects()?;
                Ok(())
            },
        );
        Self {
            prepare,
            names,
            absent,
            epoch,
            forcing,
            project,
            project_forcing,
            features,
            magic_places,
            place_effects,
        }
    }
}
