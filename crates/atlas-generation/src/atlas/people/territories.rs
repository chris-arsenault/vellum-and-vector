// Arconis: docs/architecture/subsystems.arconis#item=pp_regions — builds culture shares, realms and territorial claims.
use super::{shapes, Occurrence, Operation};
use crate::{
    atlas::state::State,
    execution::{Command, CommandKind},
    features::Relation,
    field::{
        people::{
            identity_reads, political_regions,
            traditions::{Kind, Tradition},
        },
        poi::map_records::{self, Record},
    },
    human::identity,
    identity::area_record_id,
    scale::{AreaUnit, MapScale},
    storage::Band,
};
use serde_json::json;
use std::io;
const FIRMLY_HELD: f64 = 0.75;

fn territory(
    state: &mut State,
    realm: &Tradition,
    kind: &str,
    belongs: impl Fn(usize) -> io::Result<bool>,
) -> io::Result<()> {
    let samples = state.physical.surface.samples();
    let shape = shapes::samples(state, |sample| {
        let cell = samples.get(sample)?;
        if cell < 0 {
            Ok(false)
        } else {
            belongs(cell as usize)
        }
    })?;
    let Some(shape) = shape else {
        return Ok(());
    };
    let entity = state
        .people
        .memory
        .borrow()
        .entities
        .get(&realm.entity)
        .cloned();
    let Some(entity) = entity else {
        return Ok(());
    };
    let seat = state
        .people
        .places
        .borrow()
        .known
        .iter()
        .find(|place| Some(&place.id) == realm.seat.as_ref())
        .map(|p| p.id.clone());
    let layer = if kind == "claim" { "claims" } else { kind };
    let relation = match kind {
        "sovereignty" => "sovereign",
        "control" => "controlledBy",
        _ => "claimedBy",
    };
    let mut attributes = serde_json::Map::new();
    attributes.insert(
        "status".into(),
        if seat.is_some() { "active" } else { "seatless" }.into(),
    );
    attributes.insert("founded".into(), realm.founded.clone().into());
    attributes.insert("boundaryDerivation".into(), "allegiance-held".into());
    if let Some(seat) = &seat {
        attributes.insert(
            "seat".into(),
            area_record_id(state.scope.world, false, state.scope.area, seat).into(),
        );
    }
    let mut feature = map_records::generated(
        state,
        Record {
            key: &format!("{kind}:{}", entity.id),
            name: &format!("{} {kind}", entity.name),
            kind,
            layer,
            geometry: shape,
            attributes,
        },
    )?;
    feature.relations = vec![Relation {
        target_id: entity.id,
        kind: relation.into(),
    }];
    feature.causes = vec![format!(
        "{}: the realm was founded{}. Its {kind} is the land where {} its allegiance.",
        realm.founded,
        if seat.is_some() {
            ""
        } else {
            "; its seat has since emptied"
        },
        if kind == "claim" {
            "anyone still holds"
        } else {
            "most people hold"
        }
    )];
    state.write_feature(feature.clone())?;
    if kind == "sovereignty" {
        let (parts, retained) = political_regions::records(state, &feature)?;
        state
            .retained_continental_domains
            .set(state.retained_continental_domains.get() + retained);
        for part in parts {
            state.write_feature(part)?;
        }
    }
    Ok(())
}
fn describe(state: &State, realm: &Tradition, anyone: &Band<f64>, leads: &[i32]) -> io::Result<()> {
    let field = state.field();
    let mut people = 0.0;
    for cell in 0..field.mesh().len() {
        let share = anyone.get(cell)?;
        if share > 0.0 {
            people += share
                * field.people().people(cell)?
                * MapScale::area_units(
                    field.mesh().area(cell),
                    AreaUnit::SquareMetre,
                    AreaUnit::SquareKilometre,
                );
        }
    }
    let places = state
        .people
        .places
        .borrow()
        .known
        .iter()
        .filter(|p| {
            p.abandoned.is_none() && p.absorbed_by.is_none() && leads[p.anchor] == realm.code
        })
        .count();
    if let Some(entity) = state
        .people
        .memory
        .borrow_mut()
        .entities
        .get_mut(&realm.entity)
    {
        entity.attributes.insert(
            "character".into(),
            json!({ "people": (people + 0.5).floor(), "places": places }),
        );
    }
    Ok(())
}
pub(super) fn operation() -> Operation {
    Command::with_inputs(
        "human.politics",
        CommandKind::Publish,
        vec![],
        |scope, _: &Occurrence| {
            let state: &mut State = scope.state_mut();
            if state.regional.is_some() {
                return Ok(());
            }
            let leading =
                identity_reads::leading_of(state.field(), identity::Tradition::Allegiance)?;
            let claimed = identity_reads::shares(state.field(), identity::Tradition::Allegiance)?;
            let realms = state.people.memory.borrow().traditions.known.clone();
            for realm in realms {
                if realm.kind != Kind::Allegiance || realm.ended.is_some() {
                    continue;
                }
                let Some(anyone) = claimed.get(&realm.code) else {
                    continue;
                };
                describe(state, &realm, anyone, &leading.code)?;
                territory(state, &realm, "sovereignty", |cell| {
                    Ok(leading.code[cell] == realm.code)
                })?;
                territory(state, &realm, "control", |cell| {
                    Ok(anyone.get(cell)? >= FIRMLY_HELD)
                })?;
                territory(state, &realm, "claim", |cell| Ok(anyone.get(cell)? > 0.0))?;
            }
            Ok(())
        },
    )
}
