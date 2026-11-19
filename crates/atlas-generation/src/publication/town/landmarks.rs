use super::{attrs, line, Town, TownWriter};
use crate::{
    features::records::Relation, field::poi::map_records::Record, town::major_works::Commission,
};
use atlas_map::{Geometry, Id, Position};
use serde_json::json;
use std::io;

fn key(town: &Town, index: usize) -> String {
    format!("town:{}:work:{index}", town.seat.key)
}
fn id(state: &impl TownWriter, town: &Town, index: usize, work: &Commission) -> Id {
    work.inherited_id
        .unwrap_or_else(|| state.feature_id(&key(town, index)))
}
pub(crate) fn work_name(
    state: &impl TownWriter,
    town: &Town,
    index: usize,
    work: &Commission,
) -> io::Result<String> {
    if let Some(parent) = work.inherited_id {
        if let Some(feature) = state.inherited(parent)? {
            return Ok(feature.name);
        }
    }
    state.part_name(&key(town, index), work.family.label(), work.anchor, town)
}
pub(super) fn publish(state: &mut impl TownWriter, town: &Town) -> io::Result<()> {
    for (i, link) in town.kernel_links().iter().enumerate() {
        super::write(
            state,
            &format!("town:{}:transfer:{i}", town.seat.key),
            link.kind,
            ("settlementCrossing", "structures"),
            line(&link.ends),
            attrs([
                ("settlement", json!(town.seat.name)),
                ("crossing", json!(link.kind)),
                ("travelCost", json!(link.cost)),
            ]),
        )?;
    }
    for (i, wall) in town.kernel_walls().iter().enumerate() {
        super::write(
            state,
            &format!("town:{}:enclosure:{i}", town.seat.key),
            "Enclosure wall",
            ("wall", "structures"),
            line(wall),
            attrs([("settlement", json!(town.seat.name))]),
        )?;
    }
    for (index, work) in town.works.commissions.iter().enumerate() {
        if work.members.is_empty() && work.inherited_id.is_none() {
            continue;
        }
        publish_work(state, town, index, work)?;
    }
    Ok(())
}
pub(super) fn relate_component(
    state: &impl TownWriter,
    town: &Town,
    id: crate::town::fabric::HoldingId,
    yard: &mut crate::features::Feature,
) -> io::Result<()> {
    for (index, work) in town.works.commissions.iter().enumerate() {
        if let Some(i) = work.members.iter().position(|&member| member == id) {
            yard.attributes.insert(
                "majorWorkComponent".into(),
                json!(work.design.component_label(i)),
            );
            yard.relations.push(Relation {
                target_id: self::id(state, town, index, work),
                kind: "partOf".into(),
            });
        }
    }
    Ok(())
}
fn publish_work(
    state: &mut impl TownWriter,
    town: &Town,
    index: usize,
    work: &Commission,
) -> io::Result<()> {
    let mut parts = work
        .members
        .iter()
        .map(|id| town.holdings()[id.0 as usize].outline.clone())
        .collect::<Vec<_>>();
    parts.extend(work.grounds.clone());
    let footprint = if parts.is_empty() {
        None
    } else {
        state
            .spatial()
            .union_all(&parts)
            .map_err(io::Error::other)?
    };
    let key = key(town, index);
    let work_id = id(state, town, index, work);
    let name = work_name(state, town, index, work)?;
    let attributes = attrs([
        ("majorWorkFamily", json!(work.family.key())),
        ("workDesign", json!(&work.design)),
        ("workProgram", json!(work.design.program())),
        ("settlement", json!(town.seat.name)),
        ("settlementId", json!(town.seat.key)),
        ("origin", json!(work.origin.as_str())),
        ("complete", json!(work.complete())),
        ("operating", json!(work.operating(town))),
    ]);
    let mut feature = state.record(Record {
        key: &key,
        name: &name,
        kind: "majorWork",
        layer: "structures",
        geometry: Geometry::Point {
            coordinates: Position::xy(work.anchor[0], work.anchor[1]),
        },
        attributes,
    })?;
    feature.footprint = footprint;
    retain_inherited(state, work, &mut feature)?;
    if let Some(grounds) = &work.grounds {
        feature
            .attributes
            .insert("reservedGround".into(), json!(grounds));
        feature
            .attributes
            .insert("groundsUse".into(), json!(work.design.grounds_label()));
    }
    if let Some(other) = work.counterpart {
        feature
            .attributes
            .insert("counterpart".into(), json!(other));
    }
    feature.id = work_id;
    for (members, kind) in [(&work.members, "contains"), (&work.sponsors, "sponsoredBy")] {
        for member in members {
            let relation = Relation {
                target_id: state
                    .feature_id(&format!("town:{}:holding:{}:yard", town.seat.key, member.0)),
                kind: kind.into(),
            };
            if !feature.relations.contains(&relation) {
                feature.relations.push(relation);
            }
        }
    }
    state.save(feature)
}
fn retain_inherited(
    state: &impl TownWriter,
    work: &Commission,
    feature: &mut crate::features::Feature,
) -> io::Result<()> {
    let Some(id) = work.inherited_id else {
        return Ok(());
    };
    let Some(parent) = state.inherited(id)? else {
        return Ok(());
    };
    if feature.footprint.is_none() {
        feature.footprint = parent.footprint;
    }
    if work.members.is_empty() {
        feature.geometry = parent.geometry;
        for key in [
            "complete",
            "operating",
            "reservedGround",
            "groundsUse",
            "counterpart",
        ] {
            if let Some(value) = parent.attributes.get(key) {
                feature.attributes.insert(key.into(), value.clone());
            }
        }
    }
    Ok(())
}
