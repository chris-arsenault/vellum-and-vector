use super::State;
use crate::{
    field::{
        geographic_contours as contours,
        marine_regions::{self, Region},
        poi::map_records::{self, Record},
        significance,
    },
    hpc::SmallIntSet,
    scale::MapScale,
    spatial::Overlay,
    storage::Band,
};
use atlas_map::Geometry;
use serde_json::json;
use std::io;

fn region_outline(
    state: &State,
    labels: &Band<i32>,
    region: &Region,
    ocean: &Geometry,
) -> io::Result<Option<Geometry>> {
    let mesh = state.field().mesh();
    let mut members = Vec::new();
    let mut neighbors = SmallIntSet::default();
    for cell in 0..labels.len() {
        if labels.get(cell)? != region.id as i32 {
            continue;
        }
        members.push(cell);
        for edge in 0..3 {
            if let Some(next) = mesh.neighbor(cell, edge) {
                let other = labels.get(next)?;
                if other != region.id as i32 {
                    neighbors.add(other);
                }
            }
        }
    }
    let functions = std::iter::once(region.id as i32)
        .chain(neighbors.items().iter().copied())
        .map(|id| move |cell| Ok(f64::from(labels.get(cell)? == id)))
        .collect::<Vec<_>>();
    let terms = functions
        .iter()
        .map(|f| f as contours::ReadCell<'_>)
        .collect::<Vec<_>>();
    let contour = contours::combined(state, &members, &terms, &|values| {
        values[0] - values[1..].iter().copied().fold(0.0, f64::max)
    })?;
    contours::intersect_areas(
        state.spatial.as_ref(),
        contours::clip(state, contour)?,
        Some(ocean.clone()),
    )
}
impl State {
    fn publish_ocean(&mut self, shape: Geometry, ocean: bool) -> io::Result<()> {
        let b = self.spatial.bounds(&shape).map_err(io::Error::other)?;
        let key = format!("ocean:{:.3}:{:.3}:{:.3}:{:.3}", b.0, b.1, b.2, b.3);
        let area = self.spatial.area(&shape).map_err(io::Error::other)?;
        let feature = map_records::generated(
            self,
            Record {
                key: &key,
                name: "Ocean",
                kind: "ocean",
                layer: "oceans",
                geometry: shape,
                attributes: serde_json::from_value(
                    json!({ "sourceAlgorithm": "atlas-1", "marineType": if ocean { "ocean" } else { "sea" }, "area": area }),
                )?,
            },
        )?;
        self.write_feature(feature)?;
        Ok(())
    }
    pub fn extract_oceans(&mut self) -> io::Result<()> {
        let Some(ocean) = self.physical.ocean.clone() else {
            return Ok(());
        };
        let result = marine_regions::regions(
            self.field(),
            MapScale::native(self.physical.settings.relief.shelf_break_depth),
        )?;
        let mut selected = Vec::new();
        for region in &result.regions {
            if significance::marine(
                region.area,
                region.breadth,
                region.ocean,
                &self.field().scale(),
            )?
            .publish
            {
                selected.push(region);
            }
        }
        if selected.is_empty() {
            return Ok(());
        }
        if result.regions.len() == 1 {
            return self.publish_ocean(ocean, result.regions[0].ocean);
        }
        let labels = marine_regions::extend_labels(self.field(), &result.labels)?;
        // hpc-exempt: sparse marine region records ranked for successive polygon publication.
        selected.sort_by(|a, b| a.area.total_cmp(&b.area).then(a.id.cmp(&b.id)));
        let mut remaining = Some(ocean);
        for (at, region) in selected.iter().enumerate() {
            let Some(rest) = remaining else {
                break;
            };
            let shape = if !self.scope.world_geography && at + 1 == selected.len() {
                Some(rest.clone())
            } else {
                region_outline(self, &labels, region, &rest)?
            };
            let Some(shape) = shape else {
                remaining = Some(rest);
                continue;
            };
            self.publish_ocean(shape.clone(), region.ocean)?;
            remaining = contours::area_geometry(
                self.spatial.as_ref(),
                self.spatial
                    .overlay(&rest, &shape, Overlay::Difference)
                    .map_err(io::Error::other)?,
            )?;
        }
        Ok(())
    }
}
