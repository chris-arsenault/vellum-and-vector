//! Stored GIS sample footprints and resolved descriptions; private resources never enter records.
use super::inspection::Cell;
use crate::{
    features::chart::{working, Chart},
    field::inheritance::resources::Resource,
    reconstruction::grid_build::cell_bounds,
    spatial::{Overlay, SpatialKernel},
};
use atlas_map::{
    regions::rectangle, Bounds, Geometry, MapSample, Position, RasterBand, RegionGeometry,
    SampleAttribute, SampleWindow,
};
use std::io;

pub struct Binding<'a> {
    pub channel: &'a str,
    pub layer_id: &'a str,
    pub band: &'a RasterBand,
}
pub struct Samples<'a> {
    pub resource: &'a Resource,
    pub footprint: Geometry,
    pub space: &'a str,
    pub chart: Option<Chart<'a>>,
    pub ordinal: usize,
    pub bindings: Vec<Binding<'a>>,
}
impl Samples<'_> {
    pub fn visit(
        &self,
        spatial: &dyn SpatialKernel,
        mut emit: impl FnMut(MapSample) -> io::Result<()>,
    ) -> io::Result<()> {
        for sample in self.records(spatial)? {
            emit(sample?)?;
        }
        Ok(())
    }
    pub fn records<'a>(
        &'a self,
        spatial: &'a dyn SpatialKernel,
    ) -> io::Result<impl Iterator<Item = io::Result<MapSample>> + 'a> {
        let grid = &self.resource.grid;
        let [w, s, e, n] = grid.bounds;
        let footprint = working(
            &self.footprint,
            Bounds(w, s, e, n),
            grid.periodic_width,
            spatial,
        )
        .map_err(io::Error::other)?;
        let bands = self.bands()?;
        Ok((0..self.resource.active.len())
            .step_by(128)
            .flat_map(
                move |start| match self.batch(start, &footprint, &bands, spatial) {
                    Ok(samples) => samples.into_iter().map(Ok).collect::<Vec<_>>(),
                    Err(error) => vec![Err(error)],
                },
            ))
    }
    /// Each binding's channel and its attribute without a value, found once for all cells.
    fn bands(&self) -> io::Result<Vec<Band<'_>>> {
        self.bindings
            .iter()
            .map(|binding| {
                let channel = self
                    .resource
                    .channels
                    .get(binding.channel)
                    .filter(|channel| channel.unit == binding.band.unit)
                    .ok_or_else(|| {
                        io::Error::other(format!(
                            "Published sample {} requires its matching band and unit",
                            binding.channel
                        ))
                    })?;
                Ok(Band {
                    values: channel.values.read_values()?,
                    categories: &binding.band.categories,
                    attribute: SampleAttribute {
                        layer_id: binding.layer_id.into(),
                        band_id: binding.band.id.as_str().into(),
                        value: None,
                        unit: binding.band.unit.as_str().into(),
                        label: binding.band.name.as_str().into(),
                        display: binding.band.display.clone(),
                        category: None,
                    },
                })
            })
            .collect()
    }
    fn batch(
        &self,
        start: usize,
        footprint: &Geometry,
        bands: &[Band<'_>],
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Vec<MapSample>> {
        let end = (start + 128).min(self.resource.active.len());
        let cells = (start..end)
            .map(|index| {
                let [w, s, e, n] = cell_bounds(&self.resource.grid, index)?;
                Ok(rectangle(Bounds(w, s, e, n)))
            })
            .collect::<io::Result<Vec<_>>>()?;
        let shapes = spatial
            .overlays(footprint, &cells, Overlay::Intersection)
            .map_err(io::Error::other)?;
        (start..end)
            .zip(shapes)
            .filter_map(|(index, shape)| {
                shape.and_then(|shape| self.sample(index, shape, bands, spatial).transpose())
            })
            .collect()
    }
    fn sample(
        &self,
        index: usize,
        shape: Geometry,
        bands: &[Band<'_>],
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Option<MapSample>> {
        let grid = &self.resource.grid;
        let [w, s, e, n] = cell_bounds(grid, index)?;
        let bounds = Bounds(w, s, e, n);
        let shape = self
            .chart
            .as_ref()
            .map_or_else(
                || Ok(shape.clone()),
                |chart| chart.geometry(&shape, spatial),
            )
            .map_err(io::Error::other)?;
        let shape = crate::field::geographic_contours::area_geometry(spatial, Some(shape))?;
        let Some(footprint) = shape.and_then(region) else {
            return Ok(None);
        };
        let [x, y] = grid.position(index)?;
        let center = Position::XYZ([x, y, 0.0]);
        let center = self
            .chart
            .as_ref()
            .map_or(center, |chart| chart.position(center));
        let id = format!("{}:cell:{index}", self.ordinal);
        let attributes = bands
            .iter()
            .map(|band| band.attribute(index))
            .collect::<io::Result<_>>()?;
        let mut sections = self.sections(index)?;
        for section in &mut sections {
            section.id = format!("{id}:{}", section.id);
        }
        Ok(Some(MapSample {
            id,
            space_id: self.space.into(),
            footprint,
            window: SampleWindow {
                bounds,
                closed_east: e == grid.bounds[2],
                closed_north: n == grid.bounds[3],
            },
            cell_span: (e - w).min(n - s),
            center,
            measure: grid.measures.get(index)?,
            active: self.resource.active.get(index)? != 0,
            attributes,
            sections,
        }))
    }
    fn sections(&self, index: usize) -> io::Result<Vec<atlas_map::InspectionSection>> {
        let read = |name: &str| {
            self.resource
                .channels
                .get(name)
                .map_or(Ok(0.0), |c| c.values.get(index))
        };
        let class_name = |channel: &str, code: f64| {
            self.bindings
                .iter()
                .find(|b| b.channel == channel)
                .and_then(|b| {
                    b.band
                        .categories
                        .iter()
                        .find(|c| f64::from(c.value) == code)
                })
                .map(|c| c.label.clone())
        };
        Cell {
            read: &read,
            class_name: &class_name,
            population: self.bindings.iter().any(|b| b.channel == "Population"),
            measure: self.resource.grid.measures.get(index)?,
        }
        .sections()
    }
}
/// One published band's values and its attribute without a value.
struct Band<'a> {
    values: crate::field::schema::NumericValues<'a>,
    categories: &'a [atlas_map::Category],
    attribute: SampleAttribute,
}
impl Band<'_> {
    fn attribute(&self, index: usize) -> io::Result<SampleAttribute> {
        let value = self.values.get(index)?;
        Ok(SampleAttribute {
            value: value.is_finite().then(|| value.into()),
            category: self
                .categories
                .iter()
                .find(|c| f64::from(c.value) == value)
                .map(|c| c.label.clone()),
            ..self.attribute.clone()
        })
    }
}
fn region(shape: Geometry) -> Option<RegionGeometry> {
    match shape {
        Geometry::Polygon { coordinates } if !coordinates.is_empty() => {
            Some(RegionGeometry::Polygon(coordinates))
        }
        Geometry::MultiPolygon { coordinates } if !coordinates.is_empty() => {
            Some(RegionGeometry::MultiPolygon(coordinates))
        }
        _ => None,
    }
}
