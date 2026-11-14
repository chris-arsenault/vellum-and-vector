use super::{Occurrence, Operation};
use crate::{
    atlas::{
        regional::work::Progress,
        state::{Deliveries, State},
    },
    execution::{Command, CommandKind, Projection},
    features::{network, FeatureSelection, State as FeatureState},
    field::{landmarks::lifecycle, people::waterworks, poi::publication, projection, Field},
};
use atlas_map::Geometry;
use std::{cell::RefCell, collections::BTreeSet, io, rc::Rc};

pub struct Publication {
    pub physical: Vec<projection::channels::Channel>,
    pub derived: BTreeSet<String>,
    pub rivers: bool,
    pub lakes: bool,
    pub places: Rc<RefCell<publication::Publication>>,
    pub landmarks: Rc<lifecycle::Operations>,
    pub crossed_features: BTreeSet<String>,
}
fn drawn(state: &State) -> io::Result<Vec<usize>> {
    let mesh = state.field().mesh();
    let [ox, oy] = mesh.origin();
    let mut cells = Vec::new();
    for feature in state.records.features.values(FeatureSelection {
        area_id: Some(&state.scope.area),
        kind: Some("dam"),
        ..Default::default()
    })? {
        let feature = feature?;
        if feature.state != FeatureState::Authored {
            continue;
        }
        if let Geometry::Point { coordinates } = feature.geometry {
            let [x, y, _] = coordinates.coordinates();
            if let Some(cell) = mesh.cell_at(x - ox, y - oy) {
                cells.push(cell);
            }
        }
    }
    Ok(cells)
}
fn lake_cells(field: &Field) -> io::Result<usize> {
    let kind = field.water().column.kind;
    let mut count = 0;
    for cell in 0..field.mesh().len() {
        count += usize::from(kind.get(cell)? == 2);
    }
    Ok(count)
}
pub(super) fn advance(
    operation: Command<Field, waterworks::Era>,
    progress: Progress,
    projection: &Projection<State, Field>,
) -> Operation {
    let operation = operation.projected(projection);
    Command::with_inputs(
        "human.waterworks",
        CommandKind::Event,
        vec![],
        move |scope, era: &Occurrence| {
            let state: &State = scope.state();
            let work = waterworks::Era {
                places: state.people.places.clone(),
                works: state.people.works.clone(),
                drawn: drawn(state)?,
                era: era.era.clone(),
            };
            scope.run_with_context(&operation, &work, Rc::new(era.physical))?;
            let state = scope.state();
            progress(
                1.0,
                &format!(
                    "{} dams stand; {} cells of lake",
                    state.people.works.borrow().standing().count(),
                    lake_cells(state.field())?
                ),
            );
            Ok(())
        },
    )
}
fn drop_water(state: &mut State, crossed: &BTreeSet<String>) -> io::Result<()> {
    let mut referenced = BTreeSet::new();
    for feature in state.records.features.values(FeatureSelection::default())? {
        referenced.extend(feature?.relations.into_iter().map(|r| r.target_id));
    }
    let records = state
        .records
        .features
        .values(FeatureSelection {
            area_id: Some(&state.scope.area),
            ..Default::default()
        })?
        .collect::<io::Result<Vec<_>>>()?;
    for feature in records {
        if !["rivers", "lakes"].contains(&feature.layer_id.as_str())
            || feature.kind == "landmark"
            || feature.state != FeatureState::Generated
            || feature.protected
            || (feature.place_id.is_some() && matches!(feature.geometry, Geometry::Point { .. }))
            || !feature.detail.is_empty()
            || crossed.contains(&feature.id)
            || referenced.contains(&feature.id)
        {
            continue;
        }
        state.records.features.remove(&feature.id)?;
        let reaches = state
            .records
            .networks
            .reaches(network::Selection {
                feature_id: Some(&feature.id),
                ..Default::default()
            })?
            .collect::<io::Result<Vec<_>>>()?;
        for reach in reaches {
            state.records.networks.remove_reach(&reach.id)?;
        }
    }
    Ok(())
}
pub(super) fn present(
    water: Rc<waterworks::Operations>,
    publication: Rc<Publication>,
    progress: Progress,
    projection: &Projection<State, Field>,
) -> Operation {
    let projection = projection.clone();
    Command::with_inputs(
        "human.water-present",
        CommandKind::Publish,
        vec![],
        move |scope, era: &Occurrence| {
            let state: &State = scope.state();
            if !state.people.works.borrow_mut().take_water_moved() {
                return Ok(());
            }
            let mut cells = state
                .people
                .works
                .borrow()
                .standing()
                .map(|w| w.cell)
                .collect::<Vec<_>>();
            cells.extend(drawn(state)?);
            scope.with_context(Rc::new(era.physical), |scope| {
                water.settle(&mut scope.project(&projection), &cells)
            })?;
            let state = scope.state_mut();
            progress(
                0.0,
                &format!(
                    "Drawing the water people left: {} cells of lake",
                    lake_cells(state.field())?
                ),
            );
            let physical = &mut state.physical;
            physical.surface.project(
                physical.executor.state(),
                projection::Selection {
                    forcing_only: false,
                    physical: &publication.physical,
                    derived: Some(&publication.derived),
                },
            )?;
            state.clear_queries();
            drop_water(state, &publication.crossed_features)?;
            let drainage = if publication.rivers {
                None
            } else {
                state.drainage.take()
            };
            state.extract_geography(
                Deliveries {
                    oceans: false,
                    impacts: false,
                    volcanism: false,
                    fractures: false,
                    lakes: publication.lakes,
                    landforms: false,
                    ecology: false,
                    rivers: publication.rivers,
                    landmarks: false,
                },
                &mut publication.places.borrow_mut(),
                &publication.landmarks,
                |part, message| progress(part, message),
            )?;
            if !publication.rivers {
                state.drainage = drainage;
            }
            Ok(())
        },
    )
}
