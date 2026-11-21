use super::{
    community_records::{self, CommunityState},
    contract::Visibility,
    kinds::Kind,
    places, reads, sites,
    state::State,
    values::*,
    visibility::{self, Weights},
};
use crate::{
    features::Feature,
    field::{refinement::topology::distance, shared::Scalar},
    hpc::BitSet,
    human::{catalogue::WAY_MEMORY_YEARS, HumanField},
    magic::{channels::Channel, confluences::configuration::ResolvedConfluence},
};
use atlas_map::Geometry;
use serde_json::Value;
// hpc-exempt: named town records indexed by feature identity, not numerical cells.
use std::{collections::BTreeMap, io, rc::Rc};

pub trait SettlementState: CommunityState {
    fn confluences(&self) -> Option<std::cell::Ref<'_, [ResolvedConfluence]>>;
}
pub const KEPT_CONDITION: f64 = 0.5;
pub const DEAD_ARE_RECORDED:&str="People's layers write deaths as they happen and Salt empties the mass-death band into brine; declaring the toll again would feed it on every evaluation.";
/// The tradition most of a cell's people hold, or 0 where nobody holds one.
pub fn leading(
    state: &impl State,
    cell: usize,
    tradition: crate::human::identity::Tradition,
) -> io::Result<i32> {
    Ok(crate::human::identity::leading(&state.field()?.people.column(cell)?, tradition).0)
}
pub fn touching(state: &impl State, reach: f64) -> io::Result<f64> {
    Ok(state.field()?.scale.supported(reach, 1.5))
}
pub fn number(value: Option<&Value>, otherwise: f64) -> f64 {
    let value = match value {
        Some(Value::Null) => Some(0.0),
        Some(Value::Bool(v)) => Some(f64::from(*v)),
        Some(Value::String(v)) if v.trim().is_empty() => Some(0.0),
        Some(Value::String(v)) => v.trim().parse().ok(),
        Some(v) => v.as_f64(),
        None => None,
    };
    value.filter(|v| v.is_finite()).unwrap_or(otherwise)
}
pub fn attribute(place: &Place, name: &str, otherwise: f64) -> f64 {
    number(
        place.feature.as_ref().and_then(|f| f.attributes.get(name)),
        otherwise,
    )
}
pub fn strength(place: &Place) -> f64 {
    attribute(place, "magnitude", 1.0) * attribute(place, "condition", 1.0)
}
pub fn kept(place: &Place) -> bool {
    place
        .feature
        .as_ref()
        .and_then(|f| f.attributes.get("maintained"))
        .and_then(Value::as_bool)
        != Some(false)
        && attribute(place, "condition", 1.0) > KEPT_CONDITION
}
pub fn kept_line(place: &Place, cell: usize) -> Vec<FieldChange> {
    if kept(place) {
        vec![FieldChange::Physical(PhysicalChange {
            cell,
            band: PhysicalBand::Human(HumanField::KeptLine),
            change: Change::AtLeast(WAY_MEMORY_YEARS),
        })]
    } else {
        Vec::new()
    }
}
pub struct Sample {
    pub cell: usize,
    pub share: f64,
}
pub fn work_reach(state: &impl State, place: &Place) -> io::Result<Vec<Sample>> {
    let field = state.field()?;
    let radius = attribute(place, "radius", 0.0);
    if radius < field.scale.cells(1.0) {
        return Ok(vec![Sample {
            cell: place.anchor,
            share: (std::f64::consts::PI * radius.powi(2) / field.mesh.area(place.anchor)).min(1.0),
        }]);
    }
    Ok(sites::within(&field.mesh, place.anchor, radius)
        .into_iter()
        .map(|cell| Sample {
            cell,
            share: (-distance(&field.mesh, place.anchor, cell) / radius).exp(),
        })
        .collect())
}
pub fn people_of(town: &Feature) -> f64 {
    number(
        town.attributes
            .get("communityPopulation")
            .filter(|v| !v.is_null())
            .or_else(|| town.attributes.get("population")),
        0.0,
    )
}
pub fn near_town(
    state: &impl CommunityState,
    cell: usize,
    reach: f64,
    least: f64,
) -> io::Result<bool> {
    let marked = state
        .held()
        .get(&format!("townsReach:{reach}:{least}"), || {
            let field = state.field()?;
            let mut marked = BitSet::new(field.mesh.len());
            for town in community_records::places(state, Kind::Settlement)?.iter() {
                if least != 0.0 && !town.feature.as_ref().is_some_and(|f| people_of(f) >= least) {
                    continue;
                }
                for cell in sites::within(&field.mesh, town.anchor, touching(state, reach)?) {
                    marked.add(cell);
                }
            }
            Ok(marked)
        })?;
    Ok(marked.has(cell))
}
// hpc-exempt: sparse town feature identities, never numerical cell storage.
fn towns_by_id(state: &impl CommunityState) -> io::Result<Rc<BTreeMap<String, Feature>>> {
    state.held().get("townsById", || {
        // hpc-exempt: sparse named community records, retaining the last occurrence per id.
        let mut towns = BTreeMap::new();
        for kind in [Kind::Settlement, Kind::Ruin] {
            for town in community_records::places(state, kind)?.iter() {
                if let Some(feature) = &town.feature {
                    towns.insert(town.id.clone(), feature.clone());
                }
            }
        }
        Ok(towns)
    })
}
pub fn seat(state: &impl CommunityState, place: &Place) -> io::Result<Option<Feature>> {
    let Some(f) = &place.feature else {
        return Ok(None);
    };
    let key = f
        .attributes
        .get("seat")
        .and_then(Value::as_str)
        .or_else(|| f.attributes.get("atPlace").and_then(Value::as_str));
    Ok(match key {
        Some(key) => towns_by_id(state)?.get(key).cloned(),
        None => None,
    })
}
pub fn gone(town: Option<&Feature>) -> bool {
    town.is_none_or(|town| {
        matches!(
            town.attributes.get("status").and_then(Value::as_str),
            Some("abandoned" | "ruined")
        )
    })
}
pub fn seat_people(state: &impl CommunityState, place: &Place) -> io::Result<f64> {
    Ok(seat(state, place)?.as_ref().map_or(0.0, people_of))
}
pub fn culture(state: &impl State, place: &Place) -> io::Result<Option<String>> {
    match place
        .feature
        .as_ref()
        .and_then(|f| f.attributes.get("namingCulture"))
        .and_then(Value::as_str)
    {
        Some(culture) => Ok(Some(culture.into())),
        None => places::naming_culture_near(state, place),
    }
}
pub fn event_kind(place: &Place) -> &str {
    place
        .feature
        .as_ref()
        .and_then(|f| f.attributes.get("eventKind"))
        .and_then(Value::as_str)
        .unwrap_or("")
}
pub fn event_magnitude(place: &Place) -> f64 {
    let toll = attribute(place, "casualties", 0.0) + attribute(place, "displaced", 0.0);
    attribute(place, "magnitude", toll / (toll + 1000.0)).min(1.0)
}
pub fn event_reach(state: &impl State, place: &Place) -> io::Result<f64> {
    let radius = attribute(place, "radius", 0.0);
    let span = state.field()?.scale.cells(1.0);
    let Some(feature) = &place.feature else {
        return Ok(radius.max(span));
    };
    if radius > 0.0 || matches!(feature.geometry, Geometry::Point { .. }) {
        return Ok(radius.max(span));
    }
    let bounds = state
        .spatial()
        .bounds(&feature.geometry)
        .map_err(io::Error::other)?;
    Ok(((bounds.2 - bounds.0) / 2.0).max(span))
}
pub fn damaged_ground(place: &Place, share: f64) -> Vec<FieldChange> {
    vec![FieldChange::Physical(PhysicalChange {
        cell: place.anchor,
        band: PhysicalBand::Scalar(Scalar::EcologicalDamage),
        change: Change::AtLeast(share * event_magnitude(place)),
    })]
}
pub fn avoided_ground(state: &impl State, place: &Place) -> io::Result<Vec<Cost>> {
    let mut costs = Vec::new();
    for cell in sites::within(
        &state.field()?.mesh,
        place.anchor,
        event_reach(state, place)?,
    ) {
        if reads::magic_rule(state, "salt", "ground", cell)? {
            costs.push(Cost {
                cell,
                factor: 1.0
                    + (reads::magic_value(state, "salt", Channel::Intensity, cell)? / 1000.0)
                        .min(1.0),
            });
        }
    }
    Ok(costs)
}
pub fn restless_dead(state: &impl SettlementState, place: &Place) -> io::Result<Vec<Hazard>> {
    let stilled = reads::magic_value(state, "aurora", Channel::Intensity, place.anchor)? >= 300.0;
    let brined = reads::magic_value(state, "salt", Channel::Intensity, place.anchor)? >= 200.0;
    let confluences = state.confluences();
    let meeting = confluences
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .find(|c| c.rule.id == "preserved")
        .and_then(|c| c.hazard.as_ref());
    Ok(if stilled && brined {
        meeting
            .map(|h| {
                vec![Hazard {
                    hazard: h.kind.clone(),
                    reach: h.radius,
                    severity: h.severity,
                }]
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    })
}
pub fn salted_hazard(state: &impl State, place: &Place) -> io::Result<Vec<Hazard>> {
    Ok(
        if reads::magic_rule(state, "salt", "ground", place.anchor)? {
            vec![Hazard {
                hazard: "salted ground".into(),
                reach: event_reach(state, place)?,
                severity: (reads::magic_value(state, "salt", Channel::Intensity, place.anchor)?
                    / 1000.0)
                    .min(1.0),
            }]
        } else {
            Vec::new()
        },
    )
}
pub fn event_fate(state: &impl State, place: &Place) -> io::Result<Fate> {
    Ok(
        if reads::magic_rule(state, "salt", "ground", place.anchor)? {
            Fate::Ends {
                leaves: Some(Kind::KillingGround),
            }
        } else {
            Fate::Persists
        },
    )
}
pub fn weighed_place<S: State>(
    state: &S,
    place: &Place,
    factors: &Visibility<S>,
    weights: &Weights,
) -> io::Result<f64> {
    if state.physical().is_none() || place.anchor == usize::MAX {
        Ok(0.0)
    } else {
        visibility::weighed(state, place, factors, weights)
    }
}
