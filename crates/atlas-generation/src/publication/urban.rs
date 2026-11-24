//! Write the completed City geography or a Street map's captured and local records.
use crate::{
    atlas::dispatch::{Input, Publication},
    execution::ExecutionResult,
    features::{Feature, State as FeatureState},
    identity::area_record_id,
};
use std::io;
pub(crate) fn publish(output: Publication<'_>, _: &Input) -> ExecutionResult<()> {
    let Some(urban) = output.urban else {
        return Ok(());
    };
    if let (Some(city), Some(policy)) = (&output.scope.city, output.template) {
        if let Some(mut seat) = output.features.get(city.settlement)?.filter(|f| {
            f.area_id == output.scope.area && f.state == FeatureState::Generated && !f.protected
        }) {
            seat.attributes
                .insert("settlementTemplate".into(), policy.selected.name().into());
            seat.attributes.insert(
                "templatePolicy".into(),
                serde_json::to_value(policy).map_err(io::Error::other)?,
            );
            output.features.put(seat)?;
        }
    }
    for saved in urban.captured() {
        if output.features.get(saved.id)?.is_some_and(|f| {
            f.area_id == output.scope.area && (f.protected || f.state == FeatureState::Authored)
        }) {
            continue;
        }
        let mut record = saved.clone();
        record.area_id = output.scope.area;
        output.features.put(record)?;
    }
    for (i, e) in urban.elements().enumerate() {
        let layer = match e.kind.as_str() {
            "district" | "cityPlace" => "settlements",
            "thoroughfare" => "roads",
            "urbanGround" | "cityBlock" => "landUse",
            "square" | "yard" => "plots",
            "building" => "structures",
            other => {
                return Err(io::Error::other(format!("Unknown urban geography {other}")).into())
            }
        };
        let id = area_record_id(
            output.scope.world,
            false,
            output.scope.area,
            &format!("urban-{}-{i}", e.kind),
        );
        if output
            .features
            .get(id)?
            .is_some_and(|f| f.protected || f.state != FeatureState::Generated)
        {
            continue;
        }
        output.features.put(Feature {
            id,
            name: e.name.clone(),
            kind: e.kind.clone(),
            area_id: output.scope.area,
            layer_id: layer.into(),
            geometry: e.geometry.clone(),
            attributes: e.attributes.clone(),
            place_id: None,
            map_only: None,
            footprint: None,
            detail: Default::default(),
            relations: vec![],
            state: FeatureState::Generated,
            protected: false,
            actor: "generator".into(),
            generation_id: None,
            generation_domain: output.scope.generation_domains.get(layer).cloned(),
            causes: vec![],
        })?;
    }
    Ok(())
}
