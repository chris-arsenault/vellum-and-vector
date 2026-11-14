use super::Selection;
use crate::{generation_document::Document, generation_frame::Geography};
use atlas_generation::{
    features::chart::Chart,
    spatial::{Predicate, SpatialKernel},
};
use atlas_map::{
    regions::{as_geometry, rectangle, validate_navigation},
    Bounds, Geometry, MapNavigationState,
};
use std::io;

// Context around the selected subject gives coasts and nearby land room to develop.
const REGIONAL_CONTEXT_FRACTION: f64 = 0.1;
impl Selection<'_> {
    pub fn footprint(
        &self,
        document: &Document,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Geometry> {
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
        let Bounds(w, s, e, n) = chart
            .compact_bounds(&subject, spatial)
            .map_err(io::Error::other)?;
        let margin = (e - w).max(n - s) * REGIONAL_CONTEXT_FRACTION;
        let bounds = Bounds(
            if chart.cylindrical {
                w - margin
            } else {
                (w - margin).max(chart.bounds.0)
            },
            (s - margin).max(chart.bounds.1),
            if chart.cylindrical {
                e + margin
            } else {
                (e + margin).min(chart.bounds.2)
            },
            (n + margin).min(chart.bounds.3),
        );
        chart
            .geometry(&rectangle(bounds), spatial)
            .map_err(io::Error::other)
    }
    pub(super) fn refinement_level(&self, spatial: &dyn SpatialKernel) -> io::Result<u32> {
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
