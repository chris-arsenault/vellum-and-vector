use super::Selection;
use crate::{generation_document::Document, generation_frame::Geography};
use atlas_generation::{
    features::{chart::Chart, context::RealScaleMap},
    spatial::{Overlay, Predicate, SpatialKernel},
};
use atlas_map::{
    regions::{as_geometry, rectangle, validate_navigation},
    Bounds, Geometry, MapNavigationState, Position,
};
use std::io;

// Context around the selected subject gives coasts and nearby land room to develop.
const REGIONAL_CONTEXT_FRACTION: f64 = 0.1;
// A real-scale map is a few hundred hexes across at most; detail multiplies its triangles.
const MIN_HEXES_ACROSS: u32 = 10;
const MAX_HEXES_ACROSS: u32 = 200;

/// A child map is its selected outline. Generation also works a band of context around it,
/// so coasts, rivers and nearby land develop across the edge; only the outline is published.
pub struct Footprint {
    pub outline: Geometry,
    pub extent: Geometry,
}
impl Selection<'_> {
    pub fn footprint(
        &self,
        document: &Document,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Footprint> {
        let geography: Geography = serde_json::from_value(document.world.clone())?;
        let chart = Chart {
            domain: &geography.reference.domain,
            bounds: spatial
                .bounds(&geography.reference.domain)
                .map_err(io::Error::other)?,
            cylindrical: geography.reference.boundary_mode.as_deref() == Some("cylinder"),
        };
        let subject = as_geometry(&self.selection.geometry);
        if !spatial
            .relation(
                &as_geometry(&self.parent.footprint),
                &subject,
                Predicate::Covers,
            )
            .map_err(io::Error::other)?
        {
            return Err(io::Error::other("Select a region inside its source map"));
        }
        if let Some(real) = &self.real_scale {
            if !(MIN_HEXES_ACROSS..=MAX_HEXES_ACROSS).contains(&real.hexes_across) {
                return Err(io::Error::other(format!(
                    "Choose between {MIN_HEXES_ACROSS} and {MAX_HEXES_ACROSS} hexes across"
                )));
            }
            let centre = spatial
                .interior_position(&subject)
                .map_err(io::Error::other)?;
            // The chosen hexes bound the map. A clicked point only centres it; a selected
            // region (a district) shapes the map, and its frame covers the whole region.
            let frame = if self.selection.region_path.is_empty() {
                real_scale_frame(real, centre, &chart)
            } else {
                chart
                    .compact_bounds(&subject, spatial)
                    .map_err(io::Error::other)?
            };
            let extent = chart
                .geometry(&rectangle(frame), spatial)
                .map_err(io::Error::other)?;
            let outline = if self.selection.region_path.is_empty() {
                extent.clone()
            } else {
                polygonal(
                    spatial
                        .overlay(&subject, &extent, Overlay::Intersection)
                        .map_err(io::Error::other)?,
                )
                .unwrap_or_else(|| extent.clone())
            };
            return Ok(Footprint {
                outline: chart
                    .geometry(&outline, spatial)
                    .map_err(io::Error::other)?,
                extent,
            });
        }
        let Bounds(w, s, e, n) = chart
            .compact_bounds(&subject, spatial)
            .map_err(io::Error::other)?;
        let band = (e - w).max(n - s) * REGIONAL_CONTEXT_FRACTION;
        let outline = chart
            .geometry(&subject, spatial)
            .map_err(io::Error::other)?;
        let buffered = spatial
            .buffer(&subject, band)
            .map_err(io::Error::other)?
            .unwrap_or_else(|| subject.clone());
        let extent = polygonal(
            spatial
                .overlay(
                    &chart
                        .geometry(&buffered, spatial)
                        .map_err(io::Error::other)?,
                    chart.domain,
                    Overlay::Intersection,
                )
                .map_err(io::Error::other)?,
        )
        .unwrap_or_else(|| outline.clone());
        Ok(Footprint { outline, extent })
    }
    pub(super) fn refinement_level(&self, spatial: &dyn SpatialKernel) -> io::Result<u32> {
        if self.real_scale.is_some() {
            // A real-scale map leaves the regional ladder; it keeps its parent's level.
            return Ok(self.parent.region_scale.level);
        }
        if self.city.is_some() {
            // A city map refines to the level whose cells give its extent a region's count.
            let area = spatial
                .area(&as_geometry(&self.selection.geometry))
                .map_err(io::Error::other)?;
            return Ok(
                atlas_generation::atlas::resolution::Quality::level_for_extent(area)
                    .max(self.parent.region_scale.level + 1),
            );
        }
        let path = &self.selection.region_path;
        if let Some(selected) = path.last() {
            let state = MapNavigationState {
                regions: path.clone(),
                ..Default::default()
            };
            validate_navigation(self.parent, &state, spatial).map_err(io::Error::other)?;
            let mut parent = None;
            for region in path {
                if region.parent_id.as_ref() != parent || region.child.is_some() {
                    return Err(io::Error::other(
                        "Select a region through its unmapped ancestry",
                    ));
                }
                parent = Some(&region.id);
            }
            let shape = as_geometry(&selected.geometry);
            let selected_shape = as_geometry(&self.selection.geometry);
            if selected.space_id != self.selection.space_id
                || !spatial
                    .relation(&shape, &selected_shape, Predicate::Covers)
                    .map_err(io::Error::other)?
                || !spatial
                    .relation(&selected_shape, &shape, Predicate::Covers)
                    .map_err(io::Error::other)?
            {
                return Err(io::Error::other(
                    "Refine the selected region's complete outline",
                ));
            }
        }
        self.parent
            .region_scale
            .level
            .checked_add(u32::try_from(path.len().max(1)).map_err(io::Error::other)?)
            .ok_or_else(|| io::Error::other("Refinement level exceeds its representation"))
    }
}
/// The polygonal part of an overlay; a selection touching only at its edge has none.
fn polygonal(geometry: Option<Geometry>) -> Option<Geometry> {
    geometry.and_then(atlas_map::regions::polygon)
}
/// A 4:3 frame of the chosen hexes across, centred on the selection and kept on the chart.
pub fn real_scale_frame(real: &RealScaleMap, centre: Position, chart: &Chart<'_>) -> Bounds {
    let width = f64::from(real.hexes_across.max(1)) * real.hex_size.across_flats();
    let height = width * 0.75;
    let [x, y, _] = centre.coordinates();
    let fit = |middle: f64, half: f64, low: f64, high: f64| {
        if high - low <= 2.0 * half {
            (low + high) / 2.0
        } else {
            middle.clamp(low + half, high - half)
        }
    };
    let x = if chart.cylindrical {
        x
    } else {
        fit(x, width / 2.0, chart.bounds.0, chart.bounds.2)
    };
    let y = fit(y, height / 2.0, chart.bounds.1, chart.bounds.3);
    Bounds(
        x - width / 2.0,
        y - height / 2.0,
        x + width / 2.0,
        y + height / 2.0,
    )
}
