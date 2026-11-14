//! Current fieldExtrema.ts contract queries, including later-overlay precedence.
mod adaptive;
use super::{Grid, Interpolator, Layout};
use crate::{
    features::chart::working,
    field::{projection::channels::Quantity, schema::NumericBand},
    spatial::{Overlay, SpatialKernel},
    storage::Coverage,
};
use atlas_map::{regions::rectangle, Bounds, Geometry, Position};
use std::io;

pub struct Field<'a> {
    pub grid: &'a Grid,
    pub footprint: &'a Geometry,
    pub values: NumericBand,
    pub discrete: bool,
    /// Only patches that publish this channel, in publication order.
    pub overlays: Vec<Field<'a>>,
}
pub fn discrete(unit: &str, quantity: Quantity) -> bool {
    matches!(unit, "category" | "cell-index")
        || matches!(quantity, Quantity::Category | Quantity::Extensive)
}
pub struct Query<'a> {
    pub spatial: &'a dyn SpatialKernel,
    pub precision: f64,
    pub coverage: &'a mut Coverage,
}
#[derive(Default)]
struct Range(Option<[f64; 2]>);
impl Range {
    fn add(&mut self, value: f64) {
        self.0 = Some(self.0.map_or([value, value], |[low, high]| {
            [low.min(value), high.max(value)]
        }));
    }
    fn include(&mut self, range: Option<[f64; 2]>) {
        if let Some([low, high]) = range {
            self.add(low);
            self.add(high);
        }
    }
}
impl Query<'_> {
    pub fn range(
        &mut self,
        field: &Field<'_>,
        footprint: &Geometry,
    ) -> io::Result<Option<[f64; 2]>> {
        if !self.precision.is_finite() || self.precision <= 0.0 {
            return Err(io::Error::other(
                "Field queries require positive spatial precision",
            ));
        }
        let start = self.coverage.begin_process();
        let result = self.layered(field, footprint);
        self.coverage.release_process(start);
        result
    }
    pub(super) fn chart(&self, field: &Field<'_>, shape: &Geometry) -> io::Result<Geometry> {
        let [w, s, e, n] = field.grid.bounds;
        working(
            shape,
            Bounds(w, s, e, n),
            field.grid.periodic_width,
            self.spatial,
        )
        .map_err(io::Error::other)
    }
    fn region(&self, field: &Field<'_>, footprint: &Geometry) -> io::Result<Option<Geometry>> {
        self.spatial
            .overlay(
                &self.chart(field, field.footprint)?,
                &self.chart(field, footprint)?,
                Overlay::Intersection,
            )
            .map_err(io::Error::other)
    }
    fn layered(&mut self, field: &Field<'_>, footprint: &Geometry) -> io::Result<Option<[f64; 2]>> {
        let mut remaining = self.region(field, footprint)?;
        let mut range = Range::default();
        for overlay in field.overlays.iter().rev() {
            let Some(region) = remaining else { break };
            range.include(self.raw(overlay, &region)?);
            remaining = self
                .spatial
                .overlay(
                    &region,
                    &self.chart(field, overlay.footprint)?,
                    Overlay::Difference,
                )
                .map_err(io::Error::other)?;
        }
        if let Some(region) = remaining {
            range.include(self.raw(field, &region)?);
        }
        Ok(range.0)
    }
    fn raw(&mut self, field: &Field<'_>, footprint: &Geometry) -> io::Result<Option<[f64; 2]>> {
        let Some(region) = self.region(field, footprint)? else {
            return Ok(None);
        };
        match &field.grid.layout {
            Layout::Adaptive(topology) => adaptive::range(self, field, topology, &region),
            Layout::Raster { width, height } => self.raster(field, &region, *width, *height),
        }
    }
    fn raster(
        &mut self,
        field: &Field<'_>,
        region: &Geometry,
        width: usize,
        height: usize,
    ) -> io::Result<Option<[f64; 2]>> {
        let [x0, y0, x1, y1] = field.grid.bounds;
        let dx = (x1 - x0) / (width - 1) as f64;
        let dy = (y1 - y0) / (height - 1) as f64;
        let Bounds(w, s, e, n) = self.spatial.bounds(region).map_err(io::Error::other)?;
        let index = |v: f64, origin: f64, span: f64, count: usize| {
            ((v - origin) / span).floor().clamp(0.0, (count - 2) as f64) as usize
        };
        let mut sampler = Interpolator::new(field.grid, field.discrete, self.coverage);
        let mut range = Range::default();
        for y in index(s, y0, dy, height)..=index(n, y0, dy, height) {
            for x in index(w, x0, dx, width)..=index(e, x0, dx, width) {
                let cell = rectangle(Bounds(
                    x0 + x as f64 * dx,
                    y0 + y as f64 * dy,
                    x0 + (x + 1) as f64 * dx,
                    y0 + (y + 1) as f64 * dy,
                ));
                if let Some(clipped) = self
                    .spatial
                    .overlay(region, &cell, Overlay::Intersection)
                    .map_err(io::Error::other)?
                {
                    trace_values(
                        &clipped,
                        &mut |p| sampler.sample(p, &|i| field.values.get(i)),
                        &mut range,
                    )?;
                }
            }
        }
        Ok(range.0)
    }
}
fn traces(shape: &Geometry) -> Vec<&[Position]> {
    match shape {
        Geometry::Point { coordinates } => vec![std::slice::from_ref(coordinates)],
        Geometry::MultiPoint { coordinates } => {
            coordinates.iter().map(std::slice::from_ref).collect()
        }
        Geometry::LineString { coordinates } => vec![coordinates],
        Geometry::Polygon { coordinates } | Geometry::MultiLineString { coordinates } => {
            coordinates.iter().map(Vec::as_slice).collect()
        }
        Geometry::MultiPolygon { coordinates } => {
            coordinates.iter().flatten().map(Vec::as_slice).collect()
        }
        Geometry::GeometryCollection { geometries } => geometries.iter().flat_map(traces).collect(),
    }
}
fn trace_values(
    shape: &Geometry,
    sample: &mut impl FnMut([f64; 2]) -> io::Result<f64>,
    range: &mut Range,
) -> io::Result<()> {
    for trace in traces(shape) {
        if let [point] = trace {
            let [x, y, _] = point.coordinates();
            range.add(sample([x, y])?);
        }
        for pair in trace.windows(2) {
            edge(pair, sample, range)?;
        }
    }
    Ok(())
}
fn edge(
    pair: &[Position],
    sample: &mut impl FnMut([f64; 2]) -> io::Result<f64>,
    range: &mut Range,
) -> io::Result<()> {
    let [ax, ay, _] = pair[0].coordinates();
    let [bx, by, _] = pair[1].coordinates();
    let mut at = |t| sample([ax + t * (bx - ax), ay + t * (by - ay)]);
    let start = at(0.0)?;
    let end = at(1.0)?;
    let middle = at(0.5)?;
    let quadratic = 2.0 * (start + end - 2.0 * middle);
    let linear = end - start - quadratic;
    let mut values = vec![start, end];
    if quadratic != 0.0 {
        let stationary = -linear / (2.0 * quadratic);
        if stationary > 0.0 && stationary < 1.0 {
            values.push(at(stationary)?);
        }
    }
    for value in values {
        if !value.is_finite() {
            return Err(io::Error::other(
                "Interpolated field values must remain finite",
            ));
        }
        range.add(value);
    }
    Ok(())
}
