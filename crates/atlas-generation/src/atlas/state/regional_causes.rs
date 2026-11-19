//! Current regional causes share the catalogue and the canonical field owners.
use super::State;
use crate::{
    execution::{Command, CommandKind},
    features::{self, FeatureReader},
    field::{
        landmarks::lifecycle::Operations,
        refinement::{
            causes::{Cause, Registry},
            courses, evidence, influence,
        },
    },
    spatial::SpatialKernel,
};
use std::{io, rc::Rc};

fn river() -> Cause<State> {
    let mut cause = Cause::new("river");
    cause.read = Some(Rc::new(|state: &mut State, evidence| {
        let regional = state.require_regional()?;
        if let Some(source) = state.records.source_features.as_deref() {
            evidence.courses.extend(courses::captured_courses(
                state.field().mesh(),
                source,
                state.scope.area,
                &regional.removed_products,
                state.field().scale().cells(1.0),
                regional.parent_span,
            )?);
        }
        Ok(())
    }));
    cause.influence = Some(Rc::new(|state, cost| {
        influence::course_cost(
            state.field().mesh(),
            cost,
            &evidence::retained_course_cells(state.field()),
            state.require_regional()?.parent_span,
            state.field().scale().cells(1.0),
        );
        Ok(())
    }));
    cause
}
fn entry() -> Cause<State> {
    let mut cause = Cause::new("river-entry");
    cause.read = Some(Rc::new(|state: &mut State, evidence| {
        evidence
            .entries
            .extend(evidence::river_entries(state.field()));
        Ok(())
    }));
    cause
}
struct FaultInput<'a> {
    source: Option<&'a dyn FeatureReader>,
    area: atlas_map::Id,
    width: f64,
    spatial: &'a dyn SpatialKernel,
}
fn fault() -> Cause<State> {
    let mut cause = Cause::new("fault");
    cause.read = Some(Rc::new(|state: &mut State, _| {
        let operation = Command::with_inputs(
            "regional.faults",
            CommandKind::Initialize,
            vec![],
            |context, input: &FaultInput<'_>| {
                evidence::faults(
                    context.state_mut(),
                    input.source,
                    input.area,
                    input.width,
                    input.spatial,
                )?;
                Ok(())
            },
        );
        state
            .physical
            .executor
            .run_with(
                &operation,
                &FaultInput {
                    source: state.records.source_features.as_deref(),
                    area: state.scope.area,
                    width: state.physical.settings.relief.fracture_width,
                    spatial: state.spatial.as_ref(),
                },
            )
            .map_err(|e| io::Error::other(format!("{e:?}")))
    }));
    cause
}
fn landmark(operations: Rc<Operations>) -> Cause<State> {
    let mut cause = Cause::new("landmark");
    cause.read = Some(Rc::new(|state: &mut State, evidence| {
        evidence.landmarks.extend(influence::captured_landmarks(
            state.field(),
            &state.physical.landmarks,
            state.spatial.as_ref(),
        )?);
        Ok(())
    }));
    cause.influence = Some(Rc::new(|state, cost| {
        for landmark in &state.require_regional()?.evidence.landmarks {
            influence::landmark_cost(
                state.field(),
                landmark,
                cost,
                state.physical.settings.relief.impact_fracture_strength,
                state.spatial.as_ref(),
            )?;
        }
        Ok(())
    }));
    cause.restore = Some(Rc::new(move |state| {
        operations.select_queries(&mut state.physical.executor);
        let operation = evidence::landmark_restore(operations.clone(), state.spatial.clone());
        let input = evidence::LandmarkRestore {
            landmarks: state.require_regional()?.evidence.landmarks.clone(),
            scene: state.landmark_scene(),
        };
        state
            .physical
            .executor
            .run_with(&operation, &input)
            .map_err(|e| io::Error::other(format!("{e:?}")))
    }));
    cause
}
impl State {
    pub(super) fn require_regional(&self) -> io::Result<&super::Regional> {
        self.regional
            .as_ref()
            .ok_or_else(|| io::Error::other("Initialize regional context before local operations"))
    }
    pub fn regional_causes(&self, landmarks: Rc<Operations>) -> Registry<Self> {
        let mut registry = Registry::default();
        for cause in [river(), entry(), landmark(landmarks), fault()] {
            registry.register(Rc::new(cause));
        }
        registry.register_catalogue(self.catalogue.clone(), Rc::new(State::grade_places));
        registry
    }
    pub fn clear_regional_products(&mut self) -> io::Result<()> {
        let regional = self.regional.as_mut().ok_or_else(|| {
            io::Error::other("Initialize regional context before clearing products")
        })?;
        features::regional::clear_products(
            self.records.features.as_mut(),
            self.records.networks.as_mut(),
            self.scope.area,
            &regional.domains,
            &mut regional.removed_products,
        )
    }
    pub fn read_regional_evidence(&mut self, causes: &Registry<Self>) -> io::Result<()> {
        self.require_regional()?;
        let evidence = causes.read(self)?;
        self.regional.as_mut().unwrap().evidence = evidence;
        Ok(())
    }
    pub fn carry_regional_identities(&mut self) -> io::Result<()> {
        let regional = self.require_regional()?;
        let removed = regional.removed_products.clone();
        let source = self.records.source_features.as_deref().ok_or_else(|| {
            io::Error::other("Regional identities require the captured source features")
        })?;
        features::regional::tag_products(
            self.records.features.as_mut(),
            source,
            self.scope.area,
            &removed,
        )?;
        self.adopt_rivers()
    }
    pub fn begin_regional_round(
        &mut self,
        causes: &Registry<Self>,
        round: usize,
    ) -> io::Result<()> {
        self.require_regional()?;
        self.regional.as_mut().unwrap().round = round;
        if round == 2 {
            causes.conjoin(self)?;
        }
        Ok(())
    }
}
