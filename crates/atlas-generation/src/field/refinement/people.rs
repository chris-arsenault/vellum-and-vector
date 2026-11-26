//! Inherited people live on the child's finer land; their parent's records remain captured.
use super::{seats::Seat, topology::within};
use crate::{
    execution::{Command, CommandContext, ExecutionResult},
    features::{FeatureReader, FeatureSelection},
    field::{
        people::{
            contract::Timing,
            era_places,
            feed::Market,
            place_country,
            places::{Adopted, History, Places},
        },
        poi::reads,
        Field,
    },
};
use atlas_map::Geometry;
use serde_json::Value;
use std::{cell::RefCell, io, rc::Rc};

pub const DEVELOPMENT_EXPOSURE: [f64; 3] = [250.0, 60.0, 20.0];

#[derive(Clone, Default)]
pub struct Parent {
    pub census: Rc<Vec<CensusCell>>,
    pub market: Option<Market>,
    pub connections: Rc<Vec<crate::field::people::feed::Connection>>,
    pub(crate) markets: Rc<Vec<SettlementCensus>>,
}

#[derive(Clone, Copy)]
pub(crate) struct SettlementCensus {
    pub cell: usize,
    pub townspeople: f64,
    pub surveyed_km2: f64,
    pub rural_people: f64,
    pub built_km2: f64,
}

#[derive(Clone, Copy)]
pub struct CensusCell {
    pub id: usize,
    pub centre: [f64; 2],
    pub span: f64,
    pub density: f64,
}

/// The same captured settlement supplies market demand and a residential census.
pub(crate) fn markets(
    field: &Field,
    features: &dyn FeatureReader,
) -> io::Result<Vec<SettlementCensus>> {
    let mut markets = Vec::new();
    for feature in features.values(FeatureSelection {
        kind: Some("settlement"),
        ..Default::default()
    })? {
        let feature = feature?;
        if !reads::inhabited(&feature) {
            continue;
        }
        let Some(cell) = reads::feature_cell(field, &feature) else {
            continue;
        };
        let census = number(
            feature
                .attributes
                .get("settlementPopulation")
                .or_else(|| feature.attributes.get("population")),
            0.0,
        )?;
        if census > 0.0 {
            let measured = |key: &str| number(feature.attributes.get(key), 0.);
            markets.push(SettlementCensus {
                cell,
                townspeople: census,
                surveyed_km2: measured("representedAreaKm2")?,
                rural_people: measured("ruralPopulation")?,
                built_km2: measured("builtKm2")?,
            });
        }
    }
    Ok(markets)
}

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
    // owner-direction(2026-11-16): the agreement clause is that major landmarks in a parent map must appear and roughly agree with a child map; that is it
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
            timing: Timing::Present,
            country: place_country::Setting {
                range,
                // A road is judged against the towns this map can show: the threshold
                // scales with the regional town threshold, as the towns themselves do.
                road_travellers: settings.road_traffic * (least / settings.town).min(1.0),
                years: 0.0,
            },
        },
    )
}
