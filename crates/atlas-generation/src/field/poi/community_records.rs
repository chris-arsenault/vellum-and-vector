//! Community records come from people's retained land, plus the child's captured seats.
use super::{
    kinds::Kind,
    land_places,
    map_records::{self, MapState, Record},
    reads,
    values::Place,
};
use crate::{
    features::{
        publication::{Named, RegionalPublisher, RegionalRecord},
        Feature, FeatureSelection,
    },
    field::people::{
        place_land::PlaceLand,
        places::{Place as KnownPlace, Places},
        traditions::Traditions,
    },
    identity::semantic_id,
};
use atlas_map::Geometry;
use std::{cell::Ref, io, rc::Rc};

pub trait CommunityState: MapState {
    fn known_places(&self) -> Ref<'_, Places>;
    fn traditions(&self) -> Ref<'_, Traditions>;
    fn name_community(
        &self,
        place: &KnownPlace,
        land: &PlaceLand,
        language: Option<&str>,
    ) -> io::Result<Named>;
    fn regional_round(&self) -> usize;
    fn seat_cell(&self, feature: &str) -> Option<usize>;
}
pub fn developed(state: &impl CommunityState) -> bool {
    !state.regional() || state.regional_round() > 0
}
pub fn local_id(state: &impl MapState, key: &str) -> io::Result<String> {
    semantic_id(
        state.world_id(),
        &format!(
            "{}:{}",
            if state.regional() {
                "regional"
            } else {
                "generated"
            },
            state.area_id()
        ),
        key,
    )
}
pub fn local_record(state: &impl MapState, record: Record<'_>) -> io::Result<Feature> {
    if !state.regional() {
        return map_records::generated(state, record);
    }
    let named = if record.attributes.contains_key("namingVersion") {
        None
    } else {
        state.geographic_name(
            record.key,
            record.kind,
            &record.geometry,
            &record.attributes,
        )?
    };
    RegionalPublisher {
        world: state.world_id(),
        area: state.area_id(),
        space: None,
        chart: state.chart(),
        spatial: state.spatial(),
    }
    .feature(RegionalRecord {
        key: record.key.into(),
        kind: record.kind.into(),
        layer_id: record.layer.into(),
        generation_domain: state.generation_domain(record.layer),
        geometry: record.geometry,
        attributes: record.attributes,
        label: record.name.into(),
        named,
    })
}
pub fn once_written(state: &impl MapState, place: &Place) -> io::Result<Option<Feature>> {
    let Some(feature) = &place.feature else {
        return Ok(None);
    };
    Ok(
        if state.regional() && state.features().get(&feature.id)?.is_some() {
            None
        } else {
            Some(feature.clone())
        },
    )
}
/// The publication command supplies its writer separately from the immutable record reads.
pub fn community_record(
    regional: bool,
    place: &Place,
    workspace: &mut dyn crate::features::FeatureWorkspace,
    scope: &crate::features::detail::Scope<'_>,
) -> io::Result<Option<Feature>> {
    let Some(feature) = &place.feature else {
        return Ok(None);
    };
    if regional {
        return Ok(if workspace.get(&feature.id)?.is_some() {
            None
        } else {
            Some(feature.clone())
        });
    }
    let Some(key) = feature.attributes.get("placeKey") else {
        return Ok(Some(feature.clone()));
    };
    let mut detail = feature.clone();
    detail
        .attributes
        .insert("poi".into(), place.kind.as_str().into());
    let kept = crate::features::detail::put_generated_detail(
        workspace,
        detail,
        &|candidate| {
            candidate.kind == "settlement" && candidate.attributes.get("placeKey") == Some(key)
        },
        FeatureSelection {
            kind: Some("settlement"),
            ..Default::default()
        },
        scope,
    )?;
    Ok(if kept { None } else { Some(feature.clone()) })
}
type WriteCommunity<S> = std::rc::Rc<dyn Fn(&mut S, &Place) -> io::Result<Option<Feature>>>;
/// The application supplies its scoped writer; the catalogue invokes it before ordinary publication.
pub struct CommunityPublication<S>(pub WriteCommunity<S>);
impl<S> super::contract::PublicationRecord<S> for CommunityPublication<S> {
    fn record(&self, state: &mut S, place: &Place) -> io::Result<Option<Feature>> {
        (self.0)(state, place)
    }
}
fn captured(state: &impl CommunityState, kind: Kind) -> io::Result<Vec<Place>> {
    let mut places = Vec::new();
    for feature in state.features().values(FeatureSelection {
        area_id: Some(state.area_id()),
        kind: Some("settlement"),
        ..Default::default()
    })? {
        let feature = feature?;
        if !matches!(feature.geometry, Geometry::Point { .. })
            || feature
                .attributes
                .get("developedBy")
                .and_then(|v| v.as_str())
                == Some("regional")
        {
            continue;
        }
        let wanted = if kind == Kind::Settlement {
            feature.layer_id == "settlements" && reads::inhabited(&feature)
        } else {
            feature.layer_id == "ruins" || !reads::inhabited(&feature)
        };
        if !wanted {
            continue;
        }
        let Some(anchor) = state.seat_cell(&feature.id).or_else(|| {
            state
                .physical()
                .and_then(|field| reads::feature_cell(field, &feature))
        }) else {
            continue;
        };
        let mut place = Place::at(kind, anchor, vec![anchor]);
        place.id = feature.id.clone();
        place.feature = Some(feature);
        places.push(place);
    }
    Ok(places)
}
pub fn places(state: &impl CommunityState, kind: Kind) -> io::Result<Rc<Vec<Place>>> {
    if !matches!(kind, Kind::Settlement | Kind::Ruin) {
        return Err(io::Error::other(
            "Community places must be settlements or ruins",
        ));
    }
    state.held().get(&format!("places:{}", kind.as_str()), || {
        if !state.regional() {
            return land_places::places(state, kind);
        }
        let mut places = captured(state, kind)?;
        if kind == Kind::Settlement {
            places.extend(land_places::places(state, kind)?);
        }
        Ok(places)
    })
}
