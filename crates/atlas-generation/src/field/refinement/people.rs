//! Inherited people live on the child's finer land; their parent's records remain captured.
use super::{seats::Seat, topology::within};
use crate::{
    execution::{Command, CommandContext, ExecutionResult},
    features::{FeatureReader, FeatureSelection},
    field::{
        people::{
            era_places, land_processes, place_country,
            places::{Adopted, History, Places},
            questions::Questions,
        },
        poi::reads,
        Field,
    },
    reconstruction::Grid,
    storage::{Band, ReadBand},
};
use atlas_map::Geometry;
use serde_json::Value;
use std::{cell::RefCell, io, rc::Rc};

pub const DEVELOPMENT_EXPOSURE: [f64; 3] = [250.0, 60.0, 20.0];
pub fn enabled(domains: &[String]) -> bool {
    domains
        .iter()
        .any(|d| ["built", "cultural", "political"].contains(&d.as_str()))
}
pub fn people_on(field: &Field) -> io::Result<f64> {
    (0..field.mesh.len()).try_fold(0.0, |sum, cell| {
        Ok(sum + field.people.people(cell)? * field.mesh.area(cell) / 1e6)
    })
}
fn feeds(field: &Field, yield_per_km2: &ReadBand<f64>) -> io::Result<f64> {
    (0..field.mesh.len()).try_fold(0.0, |sum, cell| {
        Ok(sum + yield_per_km2.get(cell)? * field.mesh.area(cell) / 1e6)
    })
}
fn parent_groups(field: &Field, parent: &Grid) -> io::Result<Band<i32>> {
    let mut groups = field.coverage.borrow_mut().allocate(-1);
    let [ox, oy] = field.mesh.origin();
    for cell in 0..field.mesh.len() {
        let [x, y] = field.mesh.position(cell);
        groups.set(
            cell,
            i32::try_from(parent.sample_index([x + ox, y + oy])?).map_err(io::Error::other)?,
        )?;
    }
    Ok(groups)
}
pub struct PopulationReadout {
    pub land: String,
    pub before: f64,
    pub after: f64,
    pub supported: f64,
    pub crops: f64,
    pub herds: f64,
    pub wild: f64,
}
impl PopulationReadout {
    pub fn message(&self) -> String {
        format!("People on the map: {} before the round, {} after it; the land as now used feeds {}; all under crops it would feed {}, under herds {}, left wild {}",
            self.before, self.after, (self.supported + 0.5).floor(), (self.crops + 0.5).floor(), (self.herds + 0.5).floor(), (self.wild + 0.5).floor())
    }
}
pub fn live(
    executor: &mut CommandContext<'_, Field>,
    operations: &land_processes::Operations,
    questions: &Questions,
    domains: &[String],
    round: usize,
    parent: Option<&Grid>,
) -> ExecutionResult<Option<PopulationReadout>> {
    if !enabled(domains) {
        return Ok(None);
    }
    let before = (people_on(executor.state())? + 0.5).floor();
    if before == 0.0 {
        return Ok(None);
    }
    // owner-direction(2026-11-16): the agreement clause is that major landmarks in a parent map must appear and roughly agree with a child map; that is it
    // owner-direction(2026-11-21): refinement does not run processes that change population, as it does not run plate advection
    // People's history is captured like the land's: a finer map draws the parent's people in
    // finer detail once, and no pass grows, starves, moves or drowns them again.
    if round == 1 {
        if let Some(parent) = parent {
            let groups = parent_groups(executor.state(), parent)?;
            executor.run(&operations.inherited, &groups.read_only())?;
        }
    }
    let season = executor.query(&questions.season)?.values();
    let land = format!(
        "Land on the map: {}",
        executor.state().land_readout(&season)?
    );
    let support = executor.query(&questions.support)?.values();
    let crop = executor.query(&questions.crop)?.values();
    let herd = executor.query(&questions.herd)?.values();
    let wild = executor.query(&questions.wild)?.values();
    let field = executor.state();
    Ok(Some(PopulationReadout {
        land,
        before,
        after: (people_on(field)? + 0.5).floor(),
        supported: feeds(field, &support)?,
        crops: feeds(field, &crop)?,
        herds: feeds(field, &herd)?,
        wild: feeds(field, &wild)?,
    }))
}
fn number(value: Option<&Value>, otherwise: f64) -> io::Result<f64> {
    match value.filter(|v| !v.is_null()) {
        None => Ok(otherwise),
        Some(Value::Bool(v)) => Ok(f64::from(*v)),
        Some(Value::String(v)) if v.trim().is_empty() => Ok(0.0),
        Some(Value::String(v)) => v.trim().parse().map_err(io::Error::other),
        Some(value) => value
            .as_f64()
            .ok_or_else(|| io::Error::other("A captured population must be numeric")),
    }
}
fn text(value: Option<&Value>, otherwise: &str) -> String {
    value
        .filter(|v| !v.is_null())
        .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_owned))
        .unwrap_or_else(|| otherwise.into())
}
pub fn adopt_captured(
    field: &Field,
    features: &dyn FeatureReader,
    area: atlas_map::Id,
    seats: &[Seat],
    parent_span: f64,
    places: &mut Places,
) -> io::Result<()> {
    for feature in features.values(FeatureSelection {
        area_id: Some(area),
        kind: Some("settlement"),
        ..Default::default()
    })? {
        let feature = feature?;
        if !matches!(feature.geometry, Geometry::Point { .. })
            || feature
                .attributes
                .get("developedBy")
                .and_then(Value::as_str)
                == Some("regional")
        {
            continue;
        }
        let Some(anchor) = seats
            .iter()
            .find(|seat| seat.feature_id == feature.id)
            .map(|seat| seat.cell)
            .or_else(|| reads::feature_cell(field, &feature))
        else {
            continue;
        };
        let attributes = &feature.attributes;
        let town_people = number(
            attributes
                .get("settlementPopulation")
                .filter(|v| !v.is_null())
                .or_else(|| attributes.get("population")),
            0.0,
        )?;
        let peak = number(attributes.get("peakPopulation"), town_people)?;
        let history = match attributes.get("history").filter(|v| v.is_array()) {
            Some(value) => serde_json::from_value::<Vec<History>>(value.clone())?,
            None => Vec::new(),
        };
        places.adopt(Adopted {
            id: feature.id,
            anchor,
            cells: within(&field.mesh, anchor, parent_span / 2.0),
            founded: text(attributes.get("founded"), "an earlier age"),
            town_people,
            peak,
            abandoned: (!reads::inhabited(&feature))
                .then(|| text(attributes.get("abandoned"), "an earlier age")),
            history,
        });
    }
    Ok(())
}
pub fn least_town(child_span: f64, parent_span: f64, world_town: f64) -> f64 {
    40.0_f64.max(world_town * (child_span / parent_span).powi(2).min(1.0))
}
pub struct PlaceSettings {
    pub last_era: Option<String>,
    pub town: f64,
    pub city_reach: f64,
    pub road_traffic: f64,
    pub parent_span: f64,
    pub child_span: f64,
}
pub struct PlaceRecords {
    pub places: Rc<RefCell<Places>>,
    pub ways: Rc<RefCell<Vec<place_country::KnownWay>>>,
    pub links: Rc<crate::links::Offers<Field>>,
}
pub fn record_places(
    executor: &mut CommandContext<'_, Field>,
    record: &Command<Field, era_places::Setting>,
    settings: &PlaceSettings,
    records: PlaceRecords,
) -> ExecutionResult<()> {
    if people_on(executor.state())? <= 0.0 {
        return Ok(());
    }
    let range = executor
        .state()
        .scale
        .resolve(
            crate::scale::RelativeMeasure::length(settings.city_reach).map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?
        .value();
    let least = least_town(settings.child_span, settings.parent_span, settings.town);
    executor.run(
        record,
        &era_places::Setting {
            places: records.places,
            ways: records.ways,
            links: records.links,
            era: settings
                .last_era
                .clone()
                .unwrap_or_else(|| "present".into()),
            least,
            town: Some(settings.town),
            country: place_country::Setting {
                range,
                // A road is judged against the towns this map can show: the threshold
                // scales with the regional town threshold, as the towns themselves do.
                road_travellers: settings.road_traffic * (least / settings.town).min(1.0),
                years: DEVELOPMENT_EXPOSURE.iter().sum(),
            },
        },
    )
}
