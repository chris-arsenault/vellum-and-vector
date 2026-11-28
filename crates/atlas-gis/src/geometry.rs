//! Safe native GEOS bindings; numerical processes depend only on SpatialKernel.
use atlas_map::spatial::{Overlay, Predicate, SpatialIndex, SpatialKernel, SpatialResult};
use atlas_map::{Bounds, Geometry, Position};
use geos::{CoordSeq, Geom, Geometry as Native, GeometryTypes, Precision};
mod coordinates;

#[derive(yoke::Yokeable)]
struct Prepared<'a>(geos::PreparedGeometry<'a>);

struct NativeAreaMask {
    // The prepared GEOS index borrows the native polygon for its entire lifetime.
    prepared: yoke::Yoke<Prepared<'static>, Box<Native>>,
    kernel: NativeGeos,
}

impl std::fmt::Debug for NativeAreaMask {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeAreaMask")
    }
}

impl atlas_map::spatial::AreaMask for NativeAreaMask {
    fn covers(&self, value: &Geometry) -> SpatialResult<bool> {
        self.prepared
            .get()
            .0
            .covers(&self.kernel.read(value)?)
            .map_err(|e| e.to_string())
    }
    fn intersection(&self, value: &Geometry) -> SpatialResult<Option<Geometry>> {
        let input = self.kernel.read(value)?;
        let area = &self.prepared.get().0;
        if area.covers(&input).map_err(|e| e.to_string())? {
            return NativeGeos::json(input);
        }
        if !area.intersects(&input).map_err(|e| e.to_string())? {
            return Ok(None);
        }
        let clipped = input
            .intersection_prec(self.prepared.backing_cart().as_ref(), self.kernel.precision)
            .map_err(|e| e.to_string())?;
        self.kernel.overlay_result(clipped)
    }
}

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
    /// The shape on the precision grid when rounding each coordinate leaves it valid and
    /// not empty. GEOS's snap-rounding noder, which costs far more than the shape itself for
    /// a building or plot, is needed only when rounding does not.
    fn on_grid(&self, value: &Geometry) -> SpatialResult<Option<Native>> {
        let rounded =
            coordinates::read_on_grid(value, self.precision).map_err(|e| e.to_string())?;
        let usable = !rounded.is_empty().map_err(|e| e.to_string())?
            && rounded.is_valid().map_err(|e| e.to_string())?;
        Ok(usable.then_some(rounded))
    }
    /// An operand for a measurement, test or overlay: valid and on the precision grid. A shape
    /// that would collapse under GEOS's snap rounding may still be accepted here; geometry that
    /// is published goes through `read_exact`, as PostGIS repeats that reduction.
    #[track_caller]
    pub(crate) fn read(&self, value: &Geometry) -> SpatialResult<Native> {
        match self.on_grid(value)? {
            Some(rounded) => Ok(rounded),
            None => self.read_exact(value),
        }
    }
    /// The shape reduced to the precision grid by GEOS's snap rounding, refused when invalid or
    /// when it collapses.
    #[track_caller]
    pub(crate) fn read_exact(&self, value: &Geometry) -> SpatialResult<Native> {
        self.reduce(value, false)
    }
    #[track_caller]
    fn reduce(&self, value: &Geometry, allow_empty: bool) -> SpatialResult<Native> {
        let geometry = coordinates::read(value).map_err(|e| e.to_string())?;
        if !geometry.is_valid().map_err(|e| e.to_string())? {
            let trace = std::backtrace::Backtrace::capture();
            if trace.status() == std::backtrace::BacktraceStatus::Captured {
                eprintln!("Invalid input to GEOS at {trace}");
            }
            return Err(format!(
                "Geometry must be valid: {} ({:?}, bounds {:?}, read at {})",
                geometry.is_valid_reason().map_err(|e| e.to_string())?,
                geometry.geometry_type().map_err(|e| e.to_string())?,
                geometry.get_extent().ok(),
                std::panic::Location::caller(),
            ));
        }
        let snapped = geometry
            .set_precision(self.precision, Precision::ValidOutput)
            .map_err(|e| e.to_string())?;
        if !allow_empty && snapped.is_empty().map_err(|e| e.to_string())? {
            // An empty shape has no bounds to report, and asking for them must not
            // replace this message with the failure to find them.
            return Err(format!(
                "Geometry collapses at its declared precision {} ({:?}, bounds {:?}, read at {})",
                self.precision,
                geometry.geometry_type().map_err(|e| e.to_string())?,
                geometry.get_extent().ok(),
                std::panic::Location::caller()
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
    pub(crate) fn overlay_result(&self, geometry: Native) -> SpatialResult<Option<Geometry>> {
        // Re-enter GEOS at floating precision, as an exported fragment will on its next read.
        // A fixed-precision overlay may retain a ring whose vertices snap onto one segment.
        let bytes = geometry.to_wkb().map_err(|e| e.to_string())?;
        let fresh = Native::new_from_wkb(&bytes).map_err(|e| e.to_string())?;
        let result = match Self::json(fresh)? {
            Some(shape) => match self.on_grid(&shape)? {
                Some(rounded) => Self::json(rounded)?,
                None => Self::json(
                    Native::new_from_wkb(&bytes)
                        .and_then(|fresh| {
                            fresh.set_precision(self.precision, Precision::ValidOutput)
                        })
                        .map_err(|e| e.to_string())?,
                )?,
            },
            None => None,
        };
        let Some(result) = result else {
            return Ok(None);
        };
        self.export_parts(result)
    }
    /// A caller may separate a clipped multipart parcel at its entrance. Each member
    /// therefore has to survive the same precision reduction as an independent input.
    fn export_parts(&self, value: Geometry) -> SpatialResult<Option<Geometry>> {
        match value {
            Geometry::MultiPolygon { coordinates } => {
                let mut parts = Vec::new();
                for polygon in coordinates {
                    match self.export_parts(Geometry::Polygon {
                        coordinates: polygon,
                    })? {
                        Some(Geometry::Polygon { coordinates }) => parts.push(coordinates),
                        Some(Geometry::MultiPolygon { coordinates }) => parts.extend(coordinates),
                        _ => {}
                    }
                }
                Ok((!parts.is_empty()).then_some(Geometry::MultiPolygon { coordinates: parts }))
            }
            Geometry::GeometryCollection { geometries } => {
                let mut parts = Vec::new();
                for geometry in geometries {
                    parts.extend(self.export_parts(geometry)?);
                }
                Ok((!parts.is_empty())
                    .then_some(Geometry::GeometryCollection { geometries: parts }))
            }
            Geometry::Polygon { .. } => {
                let snapped = coordinates::read(&value)
                    .and_then(|part| part.set_precision(self.precision, Precision::ValidOutput))
                    .map_err(|e| e.to_string())?;
                if snapped.is_empty().map_err(|e| e.to_string())? {
                    return Ok(None);
                }
                Ok(Some(value))
            }
            _ => Ok(Some(value)),
        }
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
    fn prepare_area(
        &self,
        area: &Geometry,
    ) -> SpatialResult<std::rc::Rc<dyn atlas_map::spatial::AreaMask>> {
        let native = Box::new(self.read(area)?);
        let prepared =
            yoke::Yoke::try_attach_to_cart(native, |area| area.to_prepared_geom().map(Prepared))
                .map_err(|e| e.to_string())?;
        Ok(std::rc::Rc::new(NativeAreaMask {
            prepared,
            kernel: Self {
                precision: self.precision,
            },
        }))
    }
    fn canonical(&self, value: &Geometry) -> SpatialResult<Geometry> {
        Self::json(self.read_exact(value)?)?
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
        self.overlay_result(result)
    }
    fn union_all(&self, values: &[Geometry]) -> SpatialResult<Option<Geometry>> {
        if values.is_empty() {
            return Err("Union requires at least one geometry".into());
        }
        // A union can lose any or all of its area components on the map's grid.
        let geometry = Geometry::GeometryCollection {
            geometries: values.to_vec(),
        };
        let collection = match self.on_grid(&geometry)? {
            Some(collection) => collection,
            None => self.reduce(&geometry, true)?,
        };
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
        self.overlay_result(Self::buffer_parts(&self.read(value)?, metres)?)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_operand_is_read_onto_the_precision_grid() {
        let kernel = NativeGeos::new(0.5).unwrap();
        let square = Geometry::Polygon {
            coordinates: vec![[
                [0.1, 0.2],
                [10.1, 0.1],
                [10.2, 9.9],
                [0.2, 10.1],
                [0.1, 0.2],
            ]
            .into_iter()
            .map(|[x, y]| Position::xy(x, y))
            .collect()],
        };
        let Geometry::Polygon { coordinates } =
            coordinates::write(&kernel.read(&square).unwrap()).unwrap()
        else {
            panic!("A polygon reads as a polygon");
        };
        for point in coordinates.iter().flatten() {
            let [x, y, _] = point.coordinates();
            assert_eq!((x * 2.).fract(), 0.);
            assert_eq!((y * 2.).fract(), 0.);
        }
        assert_eq!(kernel.area(&square).unwrap(), 100.);
    }
    #[test]
    fn an_empty_operand_is_refused_for_being_empty() {
        let kernel = NativeGeos::new(0.001).unwrap();
        let nothing = Geometry::MultiLineString {
            coordinates: Vec::new(),
        };
        let refusal = kernel.read(&nothing).err().unwrap();
        assert!(
            refusal.contains("collapses at its declared precision"),
            "{refusal}"
        );
    }
    #[test]
    fn clipped_fragment_is_reusable_at_the_map_precision() {
        let kernel = NativeGeos::new(0.000001).unwrap();
        let raw = Native::new_from_wkt("POLYGON ((756921.304337 64069.67997, 756921.381122 64071.16284, 756921.505213 64073.559261, 756921.304337 64069.67997))").unwrap();
        let input = coordinates::write(&raw).unwrap();
        assert!(kernel.read_exact(&input).is_err());
        // As an operand the sliver is valid once rounded; only publication refuses it.
        assert!(kernel.read(&input).is_ok());
        let result = kernel.overlay_result(raw).unwrap();
        assert!(result.is_none_or(|geometry| kernel.read(&geometry).is_ok()));
    }
}
