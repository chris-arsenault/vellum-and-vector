use super::{Binding, OwnerInputs, Region};
use crate::{
    atlas::{
        assembly,
        regional::{begin::Capture, work::CapturedGround},
        state::State,
    },
    field::{poi::carry::Outcomes, refinement::people::PlaceSettings},
};
use std::io;

pub(super) fn create(
    state: &State,
    binding: &Binding,
    input: &OwnerInputs<'_, '_>,
    region: &Region,
) -> io::Result<assembly::Region> {
    if !region.parent_span.is_finite() || region.parent_span <= 0.0 {
        return Err(io::Error::other(
            "Regional generation needs the captured parent resolution",
        ));
    }
    let captured = &binding.captured.inputs;
    let material = captured.material();
    let channel = |name: &str| {
        material
            .channels
            .get(name)
            .map(|channel| channel.values.clone())
            .ok_or_else(|| io::Error::other(format!("Captured material requires {name}")))
    };
    Ok(assembly::Region {
        capture: Capture {
            domains: input.domains.clone(),
            parent_span: region.parent_span,
            epochs: input.epochs.len(),
            rivers: region.rivers.clone(),
        },
        seed: input.seed,
        ground: CapturedGround {
            grid: material.grid.clone(),
            bedrock: channel("BedrockElevation")?,
            share: channel("GroundCutShare")?,
            depth: channel("GroundCutDepth")?,
            has_small_channels: captured.parent.contains_key("SmallChannelLength"),
        },
        causes: state.regional_causes(input.publication.landmarks.clone()),
        outcomes: Outcomes::default(),
        ecology: input
            .epochs
            .last()
            .and_then(|epoch| epoch.ecology.clone())
            .unwrap_or_default(),
        authority: input.authority.clone(),
        places: PlaceSettings {
            last_era: region.last_era.clone(),
            town: binding.parameters.town_threshold,
            city_reach: binding.parameters.city_reach,
            road_traffic: binding.parameters.road_traffic,
            parent_span: region.parent_span,
            child_span: state.field().scale().cells(1.0),
        },
        parent_people: captured
            .parent
            .get("Population")
            .map(|source| source.grid.clone()),
    })
}
