//! Region selection from completed map geometry. Port of RegionCatalog, regionGeometry and
//! regionalDistricts; hosts supply scoped catalogue polygons and published shoreline geometry.
mod candidates;
mod districts;
mod geometry;
mod state;
pub use geometry::{as_geometry, as_region, point, polygon, rectangle, translate};

use crate::spatial::{Overlay, Predicate, SpatialKernel, SpatialResult};
use crate::{
    Geometry, MapDescriptor, MapNavigationState, MapRegion, Position, RegionCandidate,
    RegionChoices, RegionDrawing, RegionDrawingResult, RegionQuery,
};
use geometry::boundary_lines;
use serde::{Deserialize, Serialize};
pub use state::{change_navigation, validate_navigation};
use ts_rs::TS;

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionInput {
    pub map: MapDescriptor,
    pub navigation: MapNavigationState,
    /// Indexed polygon records meeting the click, cuts or snap windows.
    pub sources: Vec<RegionCandidate>,
    /// Settlement points in the selected parent, read on the owning host.
    pub anchors: Vec<Position>,
    /// None means no shoreline information; an empty collection means surveyed dry land.
    pub ocean: Option<Geometry>,
}

pub struct RegionContext<'a> {
    pub input: &'a RegionInput,
    pub query: &'a RegionQuery,
    pub kernel: &'a dyn SpatialKernel,
    pub parent: Geometry,
    pub parent_area: f64,
    pub target_area: f64,
    pub precision: f64,
    pub siblings: Vec<&'a MapRegion>,
}
impl<'a> RegionContext<'a> {
    pub fn new(
        input: &'a RegionInput,
        query: &'a RegionQuery,
        kernel: &'a dyn SpatialKernel,
    ) -> SpatialResult<Self> {
        let space = input
            .map
            .spaces
            .iter()
            .find(|space| space.id == query.space_id)
            .ok_or("Choose a coordinate space on this map")?;
        if !input.map.region_scale.enabled || query.space_id != input.map.primary_space_id {
            return Err("Select regions on a geographic map".into());
        }
        query
            .viewport
            .validate_window()
            .map_err(|error| error.to_string())?;
        let lineage = state::lineage(&input.navigation, query.parent_id.as_deref())?;
        if lineage
            .iter()
            .any(|region| region.space_id != query.space_id)
        {
            return Err("Keep a region in its located space".into());
        }
        let parent = lineage.last().map_or_else(
            || geometry::as_geometry(&input.map.footprint),
            |region| geometry::as_geometry(&region.geometry),
        );
        let siblings = input
            .navigation
            .regions
            .iter()
            .filter(|region| {
                region.space_id == query.space_id
                    && region.parent_id == query.parent_id
                    && Some(&region.id) != query.editing_id.as_ref()
            })
            .collect();
        Ok(Self {
            input,
            query,
            kernel,
            parent_area: kernel.area(&parent)?,
            parent,
            target_area: input.map.region_scale.next_area
                / input
                    .map
                    .region_scale
                    .subdivision
                    .powi(lineage.len() as i32),
            precision: space.precision,
            siblings,
        })
    }
    fn available(&self, shape: &Geometry) -> SpatialResult<Option<Geometry>> {
        let mut clipped = self
            .kernel
            .overlay(shape, &self.parent, Overlay::Intersection)?
            .and_then(polygon);
        for sibling in &self.siblings {
            let Some(shape) = clipped else {
                return Ok(None);
            };
            clipped = self
                .kernel
                .overlay(
                    &shape,
                    &geometry::as_geometry(&sibling.geometry),
                    Overlay::Difference,
                )?
                .and_then(polygon);
        }
        Ok(clipped)
    }
    fn split(&self, shape: &Geometry) -> SpatialResult<Vec<Geometry>> {
        if self.query.cuts.is_empty() {
            return Ok(vec![shape.clone()]);
        }
        let mut coordinates = boundary_lines(shape);
        for cut in &self.query.cuts {
            coordinates.extend(boundary_lines(cut));
        }
        let Some(lines) = self
            .kernel
            .node_lines(&Geometry::MultiLineString { coordinates })?
        else {
            return Ok(vec![shape.clone()]);
        };
        let mut result = Vec::new();
        for face in self.kernel.polygonize(&lines)? {
            if let Some(clipped) = self.kernel.overlay(&face, shape, Overlay::Intersection)? {
                result.push(clipped);
            }
        }
        Ok(result)
    }
}

pub fn region_choices(
    input: &RegionInput,
    query: &RegionQuery,
    kernel: &dyn SpatialKernel,
) -> SpatialResult<RegionChoices> {
    let context = RegionContext::new(input, query, kernel)?;
    let position = query.position.ok_or("Choose a location")?;
    let location = point(position);
    if query.cuts.is_empty() {
        for sibling in &context.siblings {
            if kernel.relation(
                &geometry::as_geometry(&sibling.geometry),
                &location,
                Predicate::Covers,
            )? {
                return Ok(RegionChoices {
                    version: input.navigation.version,
                    child_id: Some(sibling.id.clone()),
                    candidates: vec![],
                });
            }
        }
    }
    let mut sources = Vec::new();
    let land = input
        .ocean
        .as_ref()
        .map(|ocean| match ocean {
            Geometry::GeometryCollection { geometries } if geometries.is_empty() => {
                Ok(Some(context.parent.clone()))
            }
            _ => kernel.overlay(&context.parent, ocean, Overlay::Difference),
        })
        .transpose()?
        .flatten();
    let on_land = match &land {
        Some(land) => kernel.relation(land, &location, Predicate::Covers)?,
        None => false,
    };
    for source in &input.sources {
        let shape = geometry::as_geometry(&source.geometry);
        if !source_matches(&context, &shape, &location)? {
            continue;
        }
        let shape = if on_land {
            kernel
                .overlay(&shape, land.as_ref().unwrap(), Overlay::Intersection)?
                .and_then(polygon)
        } else {
            Some(shape)
        };
        if let Some(shape) = shape {
            sources.push(candidates::Source {
                name: source.name.clone(),
                shape,
                district: false,
            });
        }
    }
    if on_land {
        sources.push(candidates::Source {
            name: "Landmass".into(),
            shape: land.unwrap(),
            district: false,
        });
    }
    if query.cuts.is_empty() {
        sources = candidates::with_districts(&context, sources)?;
    }
    Ok(RegionChoices {
        version: input.navigation.version,
        child_id: None,
        candidates: candidates::candidates(&context, sources)?,
    })
}
fn source_matches(
    context: &RegionContext<'_>,
    shape: &Geometry,
    location: &Geometry,
) -> SpatialResult<bool> {
    if context.query.cuts.is_empty() {
        return context.kernel.relation(shape, location, Predicate::Covers);
    }
    for cut in &context.query.cuts {
        if context.kernel.relation(shape, cut, Predicate::Intersects)? {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn draw_region(
    input: &RegionInput,
    drawing: &RegionDrawing,
    kernel: &dyn SpatialKernel,
) -> SpatialResult<RegionDrawingResult> {
    let context = RegionContext::new(input, &drawing.query, kernel)?;
    let lines = match &drawing.geometry {
        Geometry::LineString { .. } | Geometry::MultiLineString { .. } => {
            boundary_lines(&drawing.geometry)
        }
        _ => vec![],
    };
    if lines.is_empty() {
        let shape = context
            .available(&drawing.geometry)?
            .ok_or("Choose an outline inside the available parent region")?;
        if 2.0 * kernel.area(&shape)? / kernel.length(&shape)?
            < input.map.region_scale.minimum_width
        {
            return Err("Choose a larger outline inside the available parent region".into());
        }
        return Ok(RegionDrawingResult {
            version: input.navigation.version,
            cuts: drawing.query.cuts.clone(),
            candidate: Some(RegionCandidate {
                name: "Region".into(),
                geometry: geometry::as_region(shape)?,
            }),
            candidates: vec![],
        });
    }
    if !drawing.tolerance.is_finite() || drawing.tolerance < 0.0 {
        return Err("Choose a finite snapping distance".into());
    }
    let mut query = drawing.query.clone();
    for line in lines {
        query
            .cuts
            .push(snap_cut(&context, line, drawing.tolerance)?);
    }
    query.position = None;
    let context = RegionContext::new(input, &query, kernel)?;
    let mut sources = Vec::new();
    for source in &input.sources {
        let shape = geometry::as_geometry(&source.geometry);
        if source_matches(&context, &shape, &context.parent)? {
            sources.push(candidates::Source {
                name: source.name.clone(),
                shape,
                district: false,
            });
        }
    }
    let candidates = candidates::candidates(&context, sources)?;
    Ok(RegionDrawingResult {
        version: input.navigation.version,
        cuts: query.cuts,
        candidate: candidates.first().cloned(),
        candidates,
    })
}
fn snap_cut(
    context: &RegionContext<'_>,
    mut line: Vec<Position>,
    tolerance: f64,
) -> SpatialResult<Geometry> {
    if line.len() < 2 {
        return Err("A dividing line needs two points".into());
    }
    let mut boundaries = boundary_lines(&context.parent);
    for cut in &context.query.cuts {
        boundaries.extend(boundary_lines(cut));
    }
    for sibling in &context.siblings {
        boundaries.extend(boundary_lines(&geometry::as_geometry(&sibling.geometry)));
    }
    for source in &context.input.sources {
        boundaries.extend(boundary_lines(&geometry::as_geometry(&source.geometry)));
    }
    let edges = Geometry::MultiLineString {
        coordinates: boundaries,
    };
    for i in [0, line.len() - 1] {
        let [x, y, _] = line[i].coordinates();
        let window = crate::Bounds(x - tolerance, y - tolerance, x + tolerance, y + tolerance);
        if let Some(nearby) = context.kernel.clip_by_rect(&edges, window)? {
            let [nearest, _] = context.kernel.nearest_points(&nearby, &point(line[i]))?;
            let [nx, ny, _] = nearest.coordinates();
            if (nx - x).hypot(ny - y) <= tolerance {
                line[i] = Position::xy(nx, ny);
            }
        }
    }
    Ok(Geometry::LineString { coordinates: line })
}
