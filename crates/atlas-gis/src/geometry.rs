//! Safe native GEOS bindings; numerical processes depend only on SpatialKernel.
use atlas_map::spatial::{Overlay, Predicate, SpatialIndex, SpatialKernel, SpatialResult};
use atlas_map::{Bounds, Geometry, Position};
use geos::{CoordSeq, Geom, Geometry as Native, GeometryTypes, Precision};
mod coordinates;

pub struct NativeGeos {
    pub(crate) precision: f64,
}
impl NativeGeos {
    pub fn new(precision: f64) -> SpatialResult<Self> {
        if !precision.is_finite() || precision <= 0.0 {
            return Err("Geometry precision must be finite and positive".into());
        }
        Ok(Self { precision })
    }
    pub(crate) fn read(&self, value: &Geometry) -> SpatialResult<Native> {
        let geometry = coordinates::read(value).map_err(|e| e.to_string())?;
        if !geometry.is_valid().map_err(|e| e.to_string())? {
            return Err("Geometry must be valid".into());
        }
        let snapped = geometry
            .set_precision(self.precision, Precision::ValidOutput)
            .map_err(|e| e.to_string())?;
        if snapped.is_empty().map_err(|e| e.to_string())? {
            return Err(format!(
                "Geometry collapses at its declared precision {} ({:?}, bounds {:?})",
                self.precision,
                geometry.geometry_type().map_err(|e| e.to_string())?,
                geometry.get_extent().map_err(|e| e.to_string())?
            ));
        }
        Ok(snapped)
    }
    pub(crate) fn json(mut value: Native) -> SpatialResult<Option<Geometry>> {
        if value.is_empty().map_err(|e| e.to_string())? {
            return Ok(None);
        }
        if matches!(
            value.geometry_type().map_err(|e| e.to_string())?,
            GeometryTypes::Polygon | GeometryTypes::MultiPolygon
        ) {
            value.normalize().map_err(|e| e.to_string())?;
        }
        coordinates::write(&value)
            .map(Some)
            .map_err(|e| e.to_string())
    }
    fn point(position: Position) -> Geometry {
        Geometry::Point {
            coordinates: position,
        }
    }
    pub(crate) fn position(value: Native) -> SpatialResult<Position> {
        let x = value.get_x().map_err(|e| e.to_string())?;
        let y = value.get_y().map_err(|e| e.to_string())?;
        if value.has_z().map_err(|e| e.to_string())? {
            return Ok(Position::XYZ([
                x,
                y,
                value.get_z().map_err(|e| e.to_string())?,
            ]));
        }
        Ok(Position::xy(x, y))
    }
    pub(crate) fn native_point(&self, position: Position) -> SpatialResult<Native> {
        let coordinates = position.coordinates();
        if !coordinates.iter().all(|v| v.is_finite()) {
            return Err("Point coordinates must be finite".into());
        }
        let [x, y, _] = coordinates;
        let xy = [
            (x / self.precision + 0.5).floor() * self.precision,
            (y / self.precision + 0.5).floor() * self.precision,
        ];
        Native::create_point(CoordSeq::new_from_vec(&[xy]).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    }
    fn buffer_parts(value: &Native, metres: f64) -> SpatialResult<Native> {
        if metres <= 0.0
            || !matches!(
                value.geometry_type().map_err(|e| e.to_string())?,
                GeometryTypes::MultiPoint
                    | GeometryTypes::MultiLineString
                    | GeometryTypes::MultiPolygon
                    | GeometryTypes::GeometryCollection
            )
        {
            return value.buffer(metres, 8).map_err(|e| e.to_string());
        }
        let mut parts = Vec::new();
        for index in 0..value.get_num_geometries().map_err(|e| e.to_string())? {
            let part = value.get_geometry_n(index).map_err(|e| e.to_string())?;
            parts.push(Self::buffer_parts(
                &Geom::clone(&part).map_err(|e| e.to_string())?,
                metres,
            )?);
        }
        Native::create_geometry_collection(parts)
            .map_err(|e| e.to_string())?
            .unary_union()
            .map_err(|e| e.to_string())
    }
}
impl SpatialKernel for NativeGeos {
    fn canonical(&self, value: &Geometry) -> SpatialResult<Geometry> {
        Self::json(self.read(value)?)?
            .ok_or_else(|| "A canonical feature needs nonempty geometry".into())
    }
    fn area(&self, value: &Geometry) -> SpatialResult<f64> {
        self.read(value)?.area().map_err(|e| e.to_string())
    }
    fn length(&self, value: &Geometry) -> SpatialResult<f64> {
        self.read(value)?.length().map_err(|e| e.to_string())
    }
    fn bounds(&self, value: &Geometry) -> SpatialResult<Bounds> {
        let extent = self.read(value)?.get_extent().map_err(|e| e.to_string())?;
        Ok(Bounds(extent[0], extent[1], extent[2], extent[3]))
    }
    fn relation(&self, a: &Geometry, b: &Geometry, predicate: Predicate) -> SpatialResult<bool> {
        let a = self.read(a)?;
        let b = self.read(b)?;
        match predicate {
            Predicate::Covers => a.covers(&b),
            Predicate::Intersects => a.intersects(&b),
        }
        .map_err(|e| e.to_string())
    }
    fn distance(&self, a: &Geometry, b: &Geometry) -> SpatialResult<f64> {
        self.read(a)?
            .distance(&self.read(b)?)
            .map_err(|e| e.to_string())
    }
    fn overlay(
        &self,
        a: &Geometry,
        b: &Geometry,
        operation: Overlay,
    ) -> SpatialResult<Option<Geometry>> {
        let a = self.read(a)?;
        let b = self.read(b)?;
        let result = match operation {
            Overlay::Intersection => a.intersection_prec(&b, self.precision),
            Overlay::Difference => a.difference_prec(&b, self.precision),
            Overlay::Union => a.union_prec(&b, self.precision),
        }
        .map_err(|e| e.to_string())?;
        Self::json(result)
    }
    fn union_all(&self, values: &[Geometry]) -> SpatialResult<Option<Geometry>> {
        if values.is_empty() {
            return Err("Union requires at least one geometry".into());
        }
        // The browser adapter reduces precision on the collection as one operand. A narrow
        // component can disappear there without making the surviving collection empty.
        let collection = self.read(&Geometry::GeometryCollection {
            geometries: values.to_vec(),
        })?;
        Self::json(
            collection
                .unary_union_prec(self.precision)
                .map_err(|e| e.to_string())?,
        )
    }
    fn buffer(&self, value: &Geometry, metres: f64) -> SpatialResult<Option<Geometry>> {
        if !metres.is_finite() {
            return Err("Buffer distance must be finite".into());
        }
        Self::json(Self::buffer_parts(&self.read(value)?, metres)?)
    }
    fn clip_by_rect(&self, value: &Geometry, bounds: Bounds) -> SpatialResult<Option<Geometry>> {
        Self::json(
            self.read(value)?
                .clip_by_rect(bounds.0, bounds.1, bounds.2, bounds.3)
                .map_err(|e| e.to_string())?,
        )
    }
    fn nearest_points(&self, a: &Geometry, b: &Geometry) -> SpatialResult<[Position; 2]> {
        let sequence = self
            .read(a)?
            .nearest_points(&self.read(b)?)
            .map_err(|e| e.to_string())?;
        Ok([
            Position::xy(
                sequence.get_x(0).map_err(|e| e.to_string())?,
                sequence.get_y(0).map_err(|e| e.to_string())?,
            ),
            Position::xy(
                sequence.get_x(1).map_err(|e| e.to_string())?,
                sequence.get_y(1).map_err(|e| e.to_string())?,
            ),
        ])
    }
    fn line_fraction(&self, line: &Geometry, position: Position) -> SpatialResult<f64> {
        self.read(line)?
            .project_normalized(&self.read(&Self::point(position))?)
            .map_err(|e| e.to_string())
    }
    fn line_at(&self, line: &Geometry, fraction: f64) -> SpatialResult<Position> {
        Self::position(
            self.read(line)?
                .interpolate_normalized(fraction)
                .map_err(|e| e.to_string())?,
        )
    }
    fn line_fractions(&self, line: &Geometry, points: &[Position]) -> SpatialResult<Vec<f64>> {
        let line = self.read(line)?;
        points
            .iter()
            .map(|point| {
                line.project_normalized(&self.native_point(*point)?)
                    .map_err(|e| e.to_string())
            })
            .collect()
    }
    fn interior_position(&self, value: &Geometry) -> SpatialResult<Position> {
        Self::position(
            self.read(value)?
                .point_on_surface()
                .map_err(|e| e.to_string())?,
        )
    }
    fn covers_points(&self, mask: &Geometry, points: &[Position]) -> SpatialResult<Vec<bool>> {
        let mask = self.read(mask)?;
        let prepared = mask.to_prepared_geom().map_err(|e| e.to_string())?;
        points
            .iter()
            .map(|point| {
                prepared
                    .covers(&self.native_point(*point)?)
                    .map_err(|e| e.to_string())
            })
            .collect()
    }
    fn with_point_coverage(
        &self,
        mask: &Geometry,
        visit: &mut dyn FnMut(&atlas_map::spatial::PointCoverage<'_>) -> SpatialResult<()>,
    ) -> SpatialResult<()> {
        let mask = self.read(mask)?;
        let prepared = mask.to_prepared_geom().map_err(|e| e.to_string())?;
        visit(&|point| {
            prepared
                .covers(&self.native_point(point)?)
                .map_err(|e| e.to_string())
        })
    }
    fn node_lines(&self, value: &Geometry) -> SpatialResult<Option<Geometry>> {
        Self::json(
            self.read(value)?
                .unary_union_prec(self.precision)
                .map_err(|e| e.to_string())?,
        )
    }
    fn polygonize(&self, value: &Geometry) -> SpatialResult<Vec<Geometry>> {
        let noded = self
            .read(value)?
            .unary_union_prec(self.precision)
            .map_err(|e| e.to_string())?;
        let result = Self::json(Native::polygonize(&[noded]).map_err(|e| e.to_string())?)?;
        Ok(match result {
            None => Vec::new(),
            Some(Geometry::GeometryCollection { geometries }) => geometries,
            Some(value) => vec![value],
        })
    }
    fn clip_trace(&self, value: &Geometry, mask: &Geometry) -> SpatialResult<Option<Geometry>> {
        crate::geometry_trace::clip(self, value, mask)
    }
    fn resample_trace(
        &self,
        value: &Geometry,
        deviation: f64,
        spacing: Option<f64>,
    ) -> SpatialResult<Geometry> {
        crate::geometry_trace::resample(self, value, deviation, spacing)
    }
    fn delaunay_edges(&self, points: &[Position]) -> SpatialResult<Vec<[usize; 2]>> {
        crate::geometry_sites::delaunay(self, points)
    }
    fn voronoi_cells(
        &self,
        sites: &[Position],
        bounds: Bounds,
    ) -> SpatialResult<Vec<Option<Geometry>>> {
        crate::geometry_sites::voronoi(self, sites, bounds)
    }
    fn index(&self, values: &[Geometry]) -> SpatialResult<Box<dyn SpatialIndex + '_>> {
        Ok(Box::new(crate::geometry_sites::NativeIndex::new(
            self, values,
        )?))
    }
    fn boundary(&self, value: &Geometry) -> SpatialResult<Option<Geometry>> {
        Self::json(self.read(value)?.boundary().map_err(|e| e.to_string())?)
    }
    fn relations(
        &self,
        mask: &Geometry,
        values: &[Geometry],
        predicate: Predicate,
    ) -> SpatialResult<Vec<bool>> {
        self.batch_relations(mask, values, predicate)
    }
    fn overlays(
        &self,
        mask: &Geometry,
        values: &[Geometry],
        operation: Overlay,
    ) -> SpatialResult<Vec<Option<Geometry>>> {
        self.batch_overlays(mask, values, operation)
    }
    fn intersection_areas(&self, mask: &Geometry, values: &[Geometry]) -> SpatialResult<Vec<f64>> {
        self.batch_intersection_areas(mask, values)
    }
    fn clip_windows(
        &self,
        value: &Geometry,
        windows: &[Bounds],
    ) -> SpatialResult<Vec<Option<Geometry>>> {
        let input = self.read(value)?;
        windows
            .iter()
            .map(|b| {
                Self::json(
                    input
                        .clip_by_rect(b.0, b.1, b.2, b.3)
                        .map_err(|e| e.to_string())?,
                )
            })
            .collect()
    }
    fn interiors(&self, values: &[Geometry]) -> SpatialResult<Vec<Position>> {
        values
            .iter()
            .map(|value| self.interior_position(value))
            .collect()
    }
    fn polygonize_area(
        &self,
        boundaries: &[Vec<Position>],
        includes: &mut dyn FnMut(Position) -> bool,
    ) -> SpatialResult<Option<Geometry>> {
        self.selected_area(boundaries, includes)
    }
}
