//! Permanent urban geometry at City scale and its local realization on Street maps.
mod activity;
mod avenues;
mod character;
mod circulation;
mod city;
mod claims;
mod defenses;
mod endpoints;
mod fields;
pub mod geometry;
mod grades;
mod hillside;
mod investment;
mod journeys;
mod landscape;
pub(crate) mod neighbourhood;
mod partition;
mod places;
mod programs;
pub mod registration;
pub(crate) mod street_context;
use crate::{
    atlas::state::State,
    features::{records::Attributes, Feature, FeatureSelection},
};
use atlas_map::Geometry;
use serde::{Deserialize, Serialize};
use std::io;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Element {
    pub geometry: Geometry,
    pub kind: String,
    pub name: String,
    pub attributes: Attributes,
}
impl Element {
    fn new(geometry: Geometry, kind: &str, name: &str) -> Self {
        Self {
            geometry,
            kind: kind.into(),
            name: name.into(),
            attributes: Attributes::new(),
        }
    }
    fn way(geometry: Geometry, kind: &str, class: &str, width: f64) -> Self {
        let stations = match &geometry {
            Geometry::LineString { coordinates } => coordinates.len(),
            _ => 1,
        };
        let mut value = Self::new(geometry, kind, class);
        value.attributes.insert("class".into(), class.into());
        value
            .attributes
            .insert("widths".into(), serde_json::json!(vec![width; stations]));
        value
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Urban {
    #[serde(default)]
    programs: Vec<programs::Program>,
    #[serde(default)]
    fields: fields::CityFields,
    #[serde(default)]
    layout_round: Option<usize>,
    #[serde(default)]
    sponsors: Vec<investment::Site>,
    #[serde(default)]
    defense: Vec<crate::town::walls::Wall>,
    #[serde(default)]
    inherited_defenses: Vec<Geometry>,
    #[serde(default)]
    destinations: Vec<usize>,
    #[serde(default)]
    parks: Vec<Element>,
    #[serde(default)]
    interior: Vec<(usize, Element)>,
    domain: Option<Geometry>,
    routes: Vec<Element>,
    districts: Vec<Element>,
    blocks: Vec<Element>,
    open: Vec<Element>,
    landmarks: Vec<Element>,
    captured: Vec<Feature>,
    district_child: bool,
}
impl Urban {
    pub(crate) fn housing_reserved(&self, cell: usize) -> bool {
        self.fields
            .claims
            .get(cell)
            .is_some_and(|claim| claim.reserved)
    }
    pub(crate) fn road_access(&self) -> &[f64] {
        &self.fields.access
    }
    pub(crate) fn bridge_links(
        &self,
        mesh: &crate::lattice::TriangularLattice,
    ) -> Vec<crate::links::Link> {
        grades::bridge_links(&self.routes, mesh)
    }
    fn work_at(&self, cell: usize) -> crate::town::templates::district::Demands {
        self.fields
            .sponsor
            .get(cell)
            .and_then(|s| *s)
            .and_then(|i| self.sponsors.get(i)?.work)
            .map_or_else(Default::default, |(family, _)| family.demands())
    }
    pub fn elements(&self) -> impl Iterator<Item = &Element> {
        self.districts
            .iter()
            .chain(&self.routes)
            .chain(&self.blocks)
            .chain(&self.open)
            .chain(&self.landmarks)
            .chain(self.interior.iter().map(|(_, place)| place))
    }
    pub fn captured(&self) -> &[Feature] {
        &self.captured
    }
}
/// Urban features whose published shape is authoritative when opening a finer map.
pub fn fixed_geography(kind: &str) -> bool {
    matches!(
        kind,
        "district"
            | "thoroughfare"
            | "cityBlock"
            | "urbanGround"
            | "cityWall"
            | "cityGate"
            | "park"
            | "square"
            | "cityPlace"
            | "majorWork"
            | "building"
    )
}
fn buildable(
    kernel: &dyn crate::spatial::SpatialKernel,
    mut shape: Geometry,
    reserved: &[Feature],
) -> io::Result<Option<Geometry>> {
    for f in reserved {
        let Some(remains) = kernel
            .overlay(&shape, &f.geometry, crate::spatial::Overlay::Difference)
            .map_err(io::Error::other)?
            .and_then(atlas_map::regions::polygon)
        else {
            return Ok(None);
        };
        shape = remains;
    }
    Ok(Some(shape))
}
fn values(state: &State, kind: &str) -> io::Result<Vec<Feature>> {
    selected(state, Some(kind))
}
/// Regional routes as they lie on this map after refinement fits them to the terrain.
fn ground_routes(state: &State) -> io::Result<Vec<Feature>> {
    let mut routes = Vec::new();
    for kind in ["road", "trail"] {
        for record in state.records.features.values(FeatureSelection {
            area_id: Some(state.scope.area),
            kind: Some(kind),
            layer_id: None,
        })? {
            let route = record?;
            if matches!(
                route.geometry,
                Geometry::LineString { .. } | Geometry::MultiLineString { .. }
            ) && route.attributes.get("wayKind").and_then(|v| v.as_str()) != Some("sea")
            {
                routes.push(route);
            }
        }
    }
    Ok(routes)
}
pub(crate) fn selected(state: &State, kind: Option<&str>) -> io::Result<Vec<Feature>> {
    let source = state.records.source_features.as_deref();
    let query = FeatureSelection {
        area_id: source.is_none().then_some(state.scope.area),
        kind,
        layer_id: None,
    };
    let records = match source {
        Some(reader) => reader.values(query)?,
        None => state.records.features.values(query)?,
    };
    records.collect()
}
fn reservations(state: &State) -> io::Result<Vec<Feature>> {
    Ok(selected(state, None)?
        .into_iter()
        .filter(|f| {
            f.kind != "district"
                && (matches!(f.kind.as_str(), "square" | "park" | "building")
                    || f.protected
                    || f.state == crate::features::State::Authored)
                && !atlas_map::regions::parts(&f.geometry).is_empty()
        })
        .collect())
}
pub fn capture_street(state: &mut State) -> io::Result<bool> {
    let Some(regional) = &state.regional else {
        return Ok(false);
    };
    if regional.city.urban.district_child {
        return Ok(true);
    }
    let Some(extent) = state.scope.outline.as_ref() else {
        return Ok(false);
    };
    // owner-direction(2026-11-23): City district boundaries and identities are final at City scale
    let kernel = state.spatial.as_ref();
    let mut selected = None;
    for district in values(state, "district")? {
        if atlas_map::regions::contains_outline(extent, &district.geometry, kernel)
            .map_err(io::Error::other)?
        {
            if selected.is_some() {
                return Ok(false);
            }
            selected = Some(district);
        }
    }
    let Some(district) = selected else {
        return Ok(false);
    };
    let mut captured = vec![district];
    for kind in [
        "cityBlock",
        "urbanGround",
        "cityWall",
        "cityGate",
        "thoroughfare",
        "park",
        "square",
        "majorWork",
        "cityPlace",
        "building",
        "bridge",
        "ford",
    ] {
        for feature in values(state, kind)? {
            if let Some(f) = within_frame(kernel, feature, extent)? {
                captured.push(f);
            }
        }
    }
    let city = &mut state.regional.as_mut().unwrap().city;
    if let Some(saved) = captured[0].attributes.get("templatePolicy") {
        city.template = Some(serde_json::from_value(saved.clone()).map_err(io::Error::other)?);
    }
    city.urban.district_child = true;
    city.urban.captured = captured;
    Ok(true)
}
fn within_frame(
    k: &dyn crate::spatial::SpatialKernel,
    mut f: Feature,
    frame: &Geometry,
) -> io::Result<Option<Feature>> {
    use crate::spatial::{Overlay, Predicate};
    if k.relation(frame, &f.geometry, Predicate::Covers)
        .map_err(io::Error::other)?
    {
        return Ok(Some(f));
    }
    if !k
        .relation(frame, &f.geometry, Predicate::Intersects)
        .map_err(io::Error::other)?
    {
        return Ok(None);
    }
    let shape = match &f.geometry {
        Geometry::LineString { .. } | Geometry::MultiLineString { .. } => {
            let Some(g) = k.clip_trace(&f.geometry, frame).map_err(io::Error::other)? else {
                return Ok(None);
            };
            let lines = atlas_map::regions::boundary_lines(&g);
            if lines.is_empty() {
                return Ok(None);
            }
            let clipped = Geometry::MultiLineString { coordinates: lines };
            crate::features::line_profile::clip_profiles(
                &mut f.attributes,
                &f.geometry,
                &clipped,
                k,
            )?;
            clipped
        }
        Geometry::Polygon { .. } | Geometry::MultiPolygon { .. } => {
            let Some(g) = k
                .overlay(&f.geometry, frame, Overlay::Intersection)
                .map_err(io::Error::other)?
                .and_then(atlas_map::regions::polygon)
            else {
                return Ok(None);
            };
            g
        }
        _ => return Ok(None),
    };
    f.geometry = shape;
    Ok(Some(f))
}
