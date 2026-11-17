use super::{
    catalogue::Catalogue,
    kinds::Kind,
    publication::{Publication, PublicationState},
    values::{Carried, Place, Unrealized},
};
use crate::{
    features::{Feature, FeatureReader, FeatureSelection},
    storage::Band,
};
use atlas_map::{Geometry, Position};
// hpc-exempt: carry outcome counts keyed by descriptive event text.
use std::{collections::BTreeMap, io, rc::Rc};

pub trait CarryState<Schedule>: PublicationState<Schedule> + super::map_records::MapState {
    fn source_features(&self) -> Option<&dyn FeatureReader>;
    fn hosted_cell(&self, feature: &Feature) -> io::Result<Option<usize>>;
}
#[derive(Clone)]
pub struct CarriedPlace {
    pub kind: Kind,
    pub carried: Carried,
    pub place: Place,
}
/// A carried place as captured, located where this map holds it: the captured record's facts
/// with the working record's shape, footprint and representative point, which the child bent
/// onto its own rivers (`regional_initialization::bend_record`).
pub fn captured_place<S: CarryState<Schedule>, Schedule>(
    state: &S,
    feature: &Feature,
) -> io::Result<Feature> {
    Ok(state
        .source_features()
        .map(|reader| reader.get(&feature.id))
        .transpose()?
        .flatten()
        .map_or_else(|| feature.clone(), |source| located(source, feature)))
}
/// The captured `source` record placed where the `working` record stands on this map.
pub fn located(mut source: Feature, working: &Feature) -> Feature {
    source.geometry.clone_from(&working.geometry);
    source.footprint.clone_from(&working.footprint);
    match working.attributes.get("representative") {
        Some(point) => {
            source
                .attributes
                .insert("representative".into(), point.clone());
        }
        None => {
            source.attributes.remove("representative");
        }
    }
    source
}
fn captured_kind(feature: &Feature) -> Option<Kind> {
    if feature
        .attributes
        .get("developedBy")
        .and_then(|v| v.as_str())
        == Some("regional")
    {
        return None;
    }
    let name = feature.attributes.get("poi")?.as_str()?;
    Kind::ALL.iter().copied().find(|kind| kind.as_str() == name)
}
pub fn carried_places<S: CarryState<Schedule>, Schedule>(
    state: &S,
    catalogue: &Catalogue<S, Schedule>,
) -> io::Result<Rc<Vec<CarriedPlace>>> {
    state.held().get("carried", || {
        let mut found = Vec::new();
        for stored in state.features().values(FeatureSelection {
            area_id: Some(state.area_id()),
            ..Default::default()
        })? {
            let stored = stored?;
            let Some(kind) = captured_kind(&stored) else {
                continue;
            };
            let Some(carry) = catalogue.get(kind).across_maps.carry.value() else {
                continue;
            };
            let feature = captured_place(state, &stored)?;
            let Some(carried) = carry(state, &feature)? else {
                continue;
            };
            let mut place = Place::at(kind, carried.cell, carried.cells.clone());
            place.id.clone_from(&feature.id);
            place.feature = Some(feature);
            found.push(CarriedPlace {
                kind,
                carried,
                place,
            });
        }
        Ok(found)
    })
}
fn snapshot(feature: &Feature) -> serde_json::Value {
    let mut value =
        serde_json::json!({ "geometry": feature.geometry, "attributes": feature.attributes });
    if let Some(footprint) = &feature.footprint {
        value["footprint"] = serde_json::to_value(footprint).expect("Geometry serialization");
    }
    value
}
pub fn stands_for<S: CarryState<Schedule>, Schedule>(
    state: &mut S,
    publication: &mut Publication,
    captured: &Feature,
    developed: Feature,
) -> io::Result<()> {
    let parent = captured_place(state, captured)?;
    let mut feature = captured.clone();
    feature.geometry = developed.geometry;
    feature.footprint = developed.footprint;
    feature.attributes = developed.attributes;
    for key in [
        "nameStatus",
        "namingCulture",
        "namingLanguage",
        "namingKind",
        "namingSubkind",
        "namingVersion",
        "namedInEra",
    ] {
        if let Some(value) = parent.attributes.get(key) {
            feature.attributes.insert(key.into(), value.clone());
        }
    }
    feature.attributes.remove("developedBy");
    feature
        .attributes
        .insert("capturedRecord".into(), snapshot(&parent));
    state.features_mut().put(feature)?;
    state.features_mut().remove(&developed.id)?;
    for item in &mut publication.written {
        if item.feature_id == developed.id {
            item.feature_id.clone_from(&captured.id);
        }
    }
    Ok(())
}
#[derive(Default, serde::Serialize, serde::Deserialize)]
pub struct Outcomes {
    // hpc-exempt: reporting counts keyed by outcome, not numerical simulation cells.
    lines: BTreeMap<String, usize>,
}
impl Outcomes {
    fn log(&mut self, kind: Kind, outcome: &str) {
        *self
            .lines
            .entry(format!("{}: {outcome}", kind.as_str()))
            .or_default() += 1;
    }
    // hpc-exempt: carry outcome reporting metadata.
    pub fn lines(&self) -> &BTreeMap<String, usize> {
        &self.lines
    }
}
struct Developed {
    kinds: Vec<(Kind, Band<i32>)>,
    ids: Vec<String>,
}
impl Developed {
    fn new<S: CarryState<Schedule>, Schedule>(
        state: &S,
        publication: &Publication,
    ) -> io::Result<Self> {
        let mut result = Self {
            kinds: Vec::new(),
            ids: Vec::new(),
        };
        for item in &publication.written {
            let at = result
                .kinds
                .iter()
                .position(|(kind, _)| *kind == item.kind)
                .unwrap_or_else(|| {
                    result.kinds.push((
                        item.kind,
                        state
                            .field()
                            .expect("Regional field")
                            .coverage
                            .borrow_mut()
                            .allocate(-1),
                    ));
                    result.kinds.len() - 1
                });
            for &cell in &item.place.cells {
                result.kinds[at].1.set(cell, result.ids.len() as i32)?;
            }
            result.ids.push(item.feature_id.clone());
        }
        Ok(result)
    }
    fn at(&self, kind: Kind, cell: usize) -> io::Result<Option<&str>> {
        let Some((_, cells)) = self.kinds.iter().find(|(k, _)| *k == kind) else {
            return Ok(None);
        };
        let at = cells.get(cell)?;
        Ok((at >= 0).then(|| self.ids[at as usize].as_str()))
    }
}
fn unresolved<S: CarryState<Schedule>, Schedule>(
    state: &S,
    catalogue: &Catalogue<S, Schedule>,
    item: &CarriedPlace,
    why: &str,
    outcomes: &mut Outcomes,
) -> io::Result<()> {
    let outcome = catalogue
        .get(item.kind)
        .across_maps
        .unrealized
        .value()
        .map(|f| f(state, &item.carried))
        .transpose()?;
    let outcome = match outcome {
        Some(Unrealized::Move(_)) => "move",
        Some(Unrealized::Drop) => "drop",
        _ => "keep",
    };
    outcomes.log(
        item.kind,
        &format!("{why}: left where it was (entry says {outcome})"),
    );
    Ok(())
}
fn follow_river<S: CarryState<Schedule>, Schedule>(
    state: &mut S,
    publication: &mut Publication,
    item: &CarriedPlace,
    developed: &Developed,
    outcomes: &mut Outcomes,
) -> io::Result<()> {
    let cell = state.hosted_cell(&item.carried.feature)?;
    let captured = state.features().get(&item.carried.feature.id)?;
    let (Some(cell), Some(mut captured)) = (cell, captured) else {
        outcomes.log(item.kind, "its river is not here: left");
        return Ok(());
    };
    let feature = developed
        .at(item.kind, cell)?
        .map(|id| state.features().get(id))
        .transpose()?
        .flatten();
    if let Some(feature) = feature.filter(|f| f.id != captured.id) {
        stands_for(state, publication, &item.carried.feature, feature)?;
        outcomes.log(item.kind, "follows its river: stands for the place there");
        return Ok(());
    }
    if !matches!(captured.geometry, Geometry::Point { .. }) {
        outcomes.log(item.kind, "follows its river: a line, not moved");
        return Ok(());
    }
    let before = snapshot(&captured);
    let field = state.field()?;
    let [x, y] = field.mesh.position(cell);
    let [ox, oy] = field.mesh.origin();
    captured.geometry = Geometry::Point {
        coordinates: state.chart().position(Position::XYZ([x + ox, y + oy, 0.0])),
    };
    if captured
        .attributes
        .get("capturedRecord")
        .is_none_or(|v| v.is_null())
    {
        captured.attributes.insert("capturedRecord".into(), before);
    }
    state.features_mut().put(captured)?;
    outcomes.log(item.kind, "follows its river: moved");
    Ok(())
}
fn carry_one<S: CarryState<Schedule>, Schedule>(
    state: &mut S,
    catalogue: &Catalogue<S, Schedule>,
    publication: &mut Publication,
    item: &CarriedPlace,
    developed: &Developed,
    outcomes: &mut Outcomes,
) -> io::Result<()> {
    if item
        .carried
        .feature
        .attributes
        .get("hostedBy")
        .is_some_and(|v| !v.is_null())
    {
        return follow_river(state, publication, item, developed, outcomes);
    }
    let Some(counterpart) = catalogue.get(item.kind).across_maps.counterpart.value() else {
        return Ok(());
    };
    let Some(cell) = counterpart(state, &item.carried)? else {
        return unresolved(state, catalogue, item, "no counterpart", outcomes);
    };
    let Some(id) = developed.at(item.kind, cell)? else {
        return unresolved(
            state,
            catalogue,
            item,
            "counterpart below this map's bar",
            outcomes,
        );
    };
    let Some(feature) = state.features().get(id)? else {
        return unresolved(
            state,
            catalogue,
            item,
            "counterpart already stands for another",
            outcomes,
        );
    };
    if feature.id == item.carried.feature.id {
        outcomes.log(item.kind, "is its counterpart");
        return Ok(());
    }
    stands_for(state, publication, &item.carried.feature, feature)?;
    outcomes.log(item.kind, "stands for its counterpart");
    Ok(())
}
pub fn carry_places<S: CarryState<Schedule>, Schedule>(
    state: &mut S,
    catalogue: &Catalogue<S, Schedule>,
    publication: &mut Publication,
    outcomes: &mut Outcomes,
) -> io::Result<()> {
    state.held().release();
    let developed = Developed::new(state, publication)?;
    let carried = carried_places(state, catalogue)?;
    for item in carried.iter() {
        carry_one(state, catalogue, publication, item, &developed, outcomes)?;
    }
    for stored in state.features().values(FeatureSelection {
        area_id: Some(state.area_id()),
        ..Default::default()
    })? {
        let stored = stored?;
        let Some(kind) = captured_kind(&stored) else {
            continue;
        };
        if !carried
            .iter()
            .any(|item| item.carried.feature.id == stored.id)
            && catalogue
                .get(kind)
                .across_maps
                .counterpart
                .value()
                .is_some()
        {
            outcomes.log(kind, "does not reach this map: left where it was");
        }
    }
    state.held().release();
    Ok(())
}
