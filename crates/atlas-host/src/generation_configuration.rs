//! Resolve creator choices before framing a new map; completed geography keeps its history.
use crate::generation_request::Request;
use atlas_generation::atlas::configuration::{self, Resolved};
use std::io;

pub fn resolve(request: &mut Request) -> io::Result<Resolved> {
    let area = &request
        .geography
        .areas
        .get(&request.input.area_id)
        .ok_or_else(|| configuration::error("generation_area", "Choose an existing mapped area"))?
        .area;
    let regional = area.map.is_some();
    if area.parent_id.is_some() && !regional {
        return Err(configuration::error(
            "regional_pipeline",
            "Capture the region as an independent map before generating it",
        ));
    }
    let stable = area.parent_id.is_some() || request.geography.has_generated_geography();
    request.history.normalize()?;
    if stable {
        let boundary = match request.geography.reference.boundary_mode.as_deref() {
            Some("cylinder") => 1.0,
            Some("ocean") => 2.0,
            _ => 0.0,
        };
        request.input.parameters.map_boundary = boundary;
        if let Some(foundation) = request.input.features.get_mut("physical.foundation") {
            foundation
                .settings
                .insert("mapBoundary".into(), boundary.into());
        }
        if !regional {
            if let Some(settings) = &mut request.input.settings {
                settings.normalize()?;
                fixed_history(settings, &request.history)?;
            }
        }
    }
    if request.existing
        && request
            .input
            .features
            .values()
            .any(|feature| feature.enabled == Some(false))
    {
        return Err(configuration::error(
            "process_selection",
            "Existing-map regeneration keeps its current process configuration",
        ));
    }
    let resolved = configuration::resolve(&request.input, &request.history)?;
    if stable && !regional {
        fixed_history(&resolved.settings, &request.history)?;
    }
    if !stable {
        request.geography.reference.boundary_mode = Some(
            match resolved.parameters.map_boundary {
                1.0 => "cylinder",
                2.0 => "ocean",
                _ => "none",
            }
            .into(),
        );
    }
    Ok(resolved)
}
fn fixed_history(
    settings: &configuration::Settings,
    history: &configuration::Settings,
) -> io::Result<()> {
    if serde_json::to_value(settings)? != serde_json::to_value(history)? {
        return Err(configuration::error("completed_history", "Inherited and completed history stays fixed. Configure the new world before its first generation."));
    }
    Ok(())
}
