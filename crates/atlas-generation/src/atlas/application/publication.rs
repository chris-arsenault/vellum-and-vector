use super::{Products, Region};
use crate::{
    atlas::{features::Context, people::Publication, state::State},
    field::{impacts, landmarks::lifecycle, poi::publication, projection::channels},
};
use std::{cell::RefCell, io, rc::Rc};

pub(super) fn create(
    state: &State,
    context: &Context<'_>,
    products: Products,
    region: Option<&Region>,
) -> io::Result<Publication> {
    let profile = &state.physical.settings.profile;
    let profile = match region {
        Some(region) => profile
            .regional_profile(region.parent_span, state.field().scale())
            .map_err(io::Error::other)?,
        None => profile.clone(),
    };
    let impact = Rc::new(impacts::settings::Settings::from_resolved(&profile)?);
    let volcanic_resistance = profile
        .values()
        .get("VolcanicRockResistance")
        .and_then(serde_json::Value::as_f64)
        .ok_or_else(|| {
            io::Error::other("Landmark publication requires volcanic rock resistance")
        })?;
    let landmarks = Rc::new(lifecycle::Operations::new(
        state.spatial.clone(),
        impact.clone(),
        volcanic_resistance,
        impact.impact_fracture_strength,
    ));
    Ok(Publication {
        physical: channels::physical()
            .into_iter()
            .filter(|channel| channel.selected(&|owner| context.enabled(owner)))
            .collect(),
        derived: products.fields,
        rivers: context.enabled("physical.river-networks"),
        lakes: context.enabled("water.routing"),
        places: Rc::new(RefCell::new(publication::Publication::default())),
        landmarks,
        crossed_features: products.crossed_features,
    })
}
