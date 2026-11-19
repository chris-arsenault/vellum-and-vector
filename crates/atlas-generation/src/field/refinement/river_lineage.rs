//! Each captured fragment keeps its identity even when another fragment has the same ancestry.
use super::courses::{CapturedCourse, CarriedCourse};
use crate::{
    features::{Feature, FeatureSelection, FeatureWorkspace, State},
    field::Field,
};
use atlas_map::Id;
use serde_json::Value;
use std::io;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ContinuingRiver {
    pub id: String,
    pub course: usize,
    pub head: usize,
}
/// The river a course belongs to: its drainage course key, else the course feature itself.
pub fn river_id(feature: &Feature) -> String {
    match feature.attributes.get("riverId").filter(|v| !v.is_null()) {
        Some(Value::String(id)) => id.clone(),
        Some(value) => value.to_string(),
        None => feature.id.to_string(),
    }
}
/// Capture once when regional evidence is established; later coastline changes do not recapture it.
pub fn continuing(field: &Field, courses: &[CapturedCourse]) -> io::Result<Vec<ContinuingRiver>> {
    let kind = field.water().column.kind;
    let mut result = Vec::new();
    for (at, course) in courses.iter().enumerate() {
        for &head in &course.cells {
            if kind.get(head)? != 1 {
                result.push(ContinuingRiver {
                    id: river_id(&course.feature),
                    course: at,
                    head,
                });
                break;
            }
        }
    }
    // hpc-exempt: sparse captured feature fragments ordered by discharge and identity.
    result.sort_by(|a, b| {
        courses[b.course]
            .discharge
            .total_cmp(&courses[a.course].discharge)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(result)
}
fn replaceable(feature: &Feature, contracted: &impl Fn(Id) -> bool) -> bool {
    feature.state == State::Generated
        && !feature.protected
        && feature.detail.is_empty()
        && !contracted(feature.id)
}
fn take_identity(
    features: &mut dyn FeatureWorkspace,
    id: Id,
    course: &CapturedCourse,
    contracted: &impl Fn(Id) -> bool,
) -> io::Result<()> {
    let Some(mut feature) = features.get(id)? else {
        return Ok(());
    };
    let carried = course.carried.clone().unwrap_or_else(|| CarriedCourse {
        source_id: course.feature.id,
        geometry: course.feature.geometry.clone(),
        discharge: course.discharge,
        order: course.order,
    });
    feature.name.clone_from(&course.feature.name);
    feature.place_id = Some(course.feature.place_id.unwrap_or(carried.source_id));
    for (key, default) in [("nameStatus", "proper"), ("namedInEra", "captured")] {
        feature.attributes.insert(
            key.into(),
            course
                .feature
                .attributes
                .get(key)
                .filter(|v| !v.is_null())
                .cloned()
                .unwrap_or_else(|| default.into()),
        );
    }
    for key in ["namingCulture", "namingLanguage"] {
        feature.attributes.remove(key);
        if let Some(value) = course.feature.attributes.get(key) {
            feature.attributes.insert(key.into(), value.clone());
        }
    }
    feature
        .attributes
        .insert("capturedCourse".into(), serde_json::to_value(carried)?);
    feature
        .attributes
        .insert("developedBy".into(), "regional".into());
    features.put(feature)?;
    if features
        .get(course.feature.id)?
        .is_some_and(|f| replaceable(&f, contracted))
    {
        features.remove(course.feature.id)?;
    }
    Ok(())
}
pub fn adopt(
    features: &mut dyn FeatureWorkspace,
    area: Id,
    courses: &[CapturedCourse],
    continuing: &[ContinuingRiver],
    contracted: &impl Fn(Id) -> bool,
) -> io::Result<Vec<Feature>> {
    let rivers = features
        .values(FeatureSelection {
            area_id: Some(area),
            kind: Some("river"),
            ..Default::default()
        })?
        .collect::<io::Result<Vec<_>>>()?;
    let mut restored = Vec::new();
    for river in continuing {
        let course = &courses[river.course];
        let drawn: Vec<_> = rivers
            .iter()
            .filter(|feature| {
                feature.id != course.feature.id
                    && replaceable(feature, contracted)
                    && feature
                        .attributes
                        .get("developedBy")
                        .and_then(Value::as_str)
                        == Some("regional")
                    && feature.attributes.get("riverId").and_then(Value::as_str)
                        == Some(river.id.as_str())
            })
            .collect();
        if drawn.is_empty() && features.get(course.feature.id)?.is_none() {
            restored.push(course.feature.clone());
        }
        for feature in drawn {
            take_identity(features, feature.id, course, contracted)?;
        }
    }
    Ok(restored)
}
