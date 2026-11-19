//! Geometry operations are a host capability; the core never substitutes geometry scans.
use crate::{Bounds, Geometry, Position};
use std::collections::BTreeSet;
pub type SpatialResult<T> = Result<T, String>;
/// Appendable spatial index for envelopes of evolving features. Exact predicates
/// and overlays are still evaluated on the geometries returned by the query.
#[derive(Clone, Debug, Default)]
pub struct BoundsIndex {
    tree: rstar::RTree<
        rstar::primitives::GeomWithData<rstar::primitives::Rectangle<[f64; 2]>, usize>,
    >,
    envelopes: Vec<Bounds>,
}
impl BoundsIndex {
    pub fn len(&self) -> usize {
        self.tree.size()
    }
    pub fn is_empty(&self) -> bool {
        self.tree.size() == 0
    }
    pub fn push(&mut self, bounds: Bounds) {
        let Bounds(w, s, e, n) = bounds;
        self.tree.insert(rstar::primitives::GeomWithData::new(
            rstar::primitives::Rectangle::from_corners([w, s], [e, n]),
            self.tree.size(),
        ));
        self.envelopes.push(bounds);
    }
    pub fn replace(&mut self, id: usize, bounds: Bounds) {
        let previous = self.envelopes[id];
        if previous == bounds {
            return;
        }
        let entry = |Bounds(w, s, e, n)| {
            rstar::primitives::GeomWithData::new(
                rstar::primitives::Rectangle::from_corners([w, s], [e, n]),
                id,
            )
        };
        self.tree.remove(&entry(previous));
        self.tree.insert(entry(bounds));
        self.envelopes[id] = bounds;
    }
    pub fn query(&self, Bounds(w, s, e, n): Bounds) -> Vec<usize> {
        let envelope = rstar::AABB::from_corners([w, s], [e, n]);
        let mut ids: Vec<_> = self
            .tree
            .locate_in_envelope_intersecting(envelope)
            .map(|item| item.data)
            .collect();
        ids.sort_unstable();
        ids
    }
}
pub type PointCoverage<'a> = dyn Fn(Position) -> SpatialResult<bool> + 'a;

#[derive(Clone, Copy)]
pub enum Predicate {
    Covers,
    Intersects,
}
#[derive(Clone, Copy)]
pub enum Overlay {
    Intersection,
    Difference,
    Union,
}

/// Owned native index; dropping it releases handles and never invalidates source GeoJSON.
pub trait SpatialIndex {
    fn query(&self, bounds: Bounds) -> SpatialResult<Vec<usize>>;
    /// Compute exact distances against the retained geometries in the requested envelope.
    fn distances(&self, bounds: Bounds, position: Position) -> SpatialResult<Vec<(usize, f64)>>;
    fn nearest_with_distance(&self, position: Position) -> SpatialResult<Option<(usize, f64)>>;
    fn nearest(&self, position: Position) -> SpatialResult<Option<usize>> {
        Ok(self.nearest_with_distance(position)?.map(|(i, _)| i))
    }
    fn nearest_many(&self, positions: &[Position]) -> SpatialResult<Vec<Option<usize>>> {
        positions
            .iter()
            .map(|&position| self.nearest(position))
            .collect()
    }
}

/// Coarse geometry operations may process a whole feature or point batch per host crossing.
pub trait SpatialKernel {
    fn canonical(&self, value: &Geometry) -> SpatialResult<Geometry>;
    fn area(&self, value: &Geometry) -> SpatialResult<f64>;
    fn length(&self, value: &Geometry) -> SpatialResult<f64>;
    fn bounds(&self, value: &Geometry) -> SpatialResult<Bounds>;
    fn relation(&self, a: &Geometry, b: &Geometry, predicate: Predicate) -> SpatialResult<bool>;
    fn distance(&self, a: &Geometry, b: &Geometry) -> SpatialResult<f64>;
    fn overlay(
        &self,
        a: &Geometry,
        b: &Geometry,
        operation: Overlay,
    ) -> SpatialResult<Option<Geometry>>;
    fn union_all(&self, values: &[Geometry]) -> SpatialResult<Option<Geometry>>;
    fn buffer(&self, value: &Geometry, metres: f64) -> SpatialResult<Option<Geometry>>;
    fn clip_by_rect(&self, value: &Geometry, bounds: Bounds) -> SpatialResult<Option<Geometry>>;
    fn nearest_points(&self, a: &Geometry, b: &Geometry) -> SpatialResult<[Position; 2]>;
    fn line_fraction(&self, line: &Geometry, position: Position) -> SpatialResult<f64>;
    fn line_fractions(&self, line: &Geometry, points: &[Position]) -> SpatialResult<Vec<f64>>;
    fn line_at(&self, line: &Geometry, fraction: f64) -> SpatialResult<Position>;
    fn interior_position(&self, value: &Geometry) -> SpatialResult<Position>;
    fn covers_points(&self, mask: &Geometry, points: &[Position]) -> SpatialResult<Vec<bool>>;
    /// Reuse one prepared mask for adaptive queries whose next point depends on the result.
    fn with_point_coverage(
        &self,
        mask: &Geometry,
        visit: &mut dyn FnMut(&PointCoverage<'_>) -> SpatialResult<()>,
    ) -> SpatialResult<()>;
    fn node_lines(&self, value: &Geometry) -> SpatialResult<Option<Geometry>>;
    fn polygonize(&self, value: &Geometry) -> SpatialResult<Vec<Geometry>>;
    fn clip_trace(&self, value: &Geometry, mask: &Geometry) -> SpatialResult<Option<Geometry>>;
    fn resample_trace(
        &self,
        value: &Geometry,
        deviation: f64,
        spacing: Option<f64>,
    ) -> SpatialResult<Geometry>;
    fn delaunay_edges(&self, points: &[Position]) -> SpatialResult<Vec<[usize; 2]>>;
    fn voronoi_cells(
        &self,
        sites: &[Position],
        bounds: Bounds,
    ) -> SpatialResult<Vec<Option<Geometry>>>;
    fn index(&self, values: &[Geometry]) -> SpatialResult<Box<dyn SpatialIndex + '_>>;
    fn boundary(&self, value: &Geometry) -> SpatialResult<Option<Geometry>>;
    fn relations(
        &self,
        mask: &Geometry,
        values: &[Geometry],
        predicate: Predicate,
    ) -> SpatialResult<Vec<bool>>;
    /// Inputs are left operands; the reusable mask is the right operand, including difference.
    fn overlays(
        &self,
        mask: &Geometry,
        values: &[Geometry],
        operation: Overlay,
    ) -> SpatialResult<Vec<Option<Geometry>>>;
    fn intersection_areas(&self, mask: &Geometry, values: &[Geometry]) -> SpatialResult<Vec<f64>>;
    fn clip_windows(
        &self,
        value: &Geometry,
        windows: &[Bounds],
    ) -> SpatialResult<Vec<Option<Geometry>>>;
    fn interiors(&self, values: &[Geometry]) -> SpatialResult<Vec<Position>>;
    fn crossings(&self, value: &Geometry, footprint: &Geometry) -> SpatialResult<Vec<Position>> {
        let Some(boundary) = self.boundary(footprint)? else {
            return Ok(Vec::new());
        };
        let Some(shape) = self.overlay(value, &boundary, Overlay::Intersection)? else {
            return Ok(Vec::new());
        };
        let mut coordinates = Vec::new();
        positions(&shape, &mut coordinates);
        let mut seen = BTreeSet::new();
        Ok(coordinates
            .into_iter()
            .filter(|p| {
                let [x, y, _] = p.coordinates();
                let bits = |v: f64| if v == 0.0 { 0 } else { v.to_bits() };
                seen.insert((bits(x), bits(y)))
            })
            .map(|p| {
                let [x, y, _] = p.coordinates();
                Position::xy(x, y)
            })
            .collect())
    }
    fn polygonize_area(
        &self,
        boundaries: &[Vec<Position>],
        includes: &mut dyn FnMut(Position) -> bool,
    ) -> SpatialResult<Option<Geometry>> {
        if boundaries.is_empty() {
            return Ok(None);
        }
        let faces = self.polygonize(&Geometry::MultiLineString {
            coordinates: boundaries.to_vec(),
        })?;
        let points = self.interiors(&faces)?;
        let selected: Vec<_> = faces
            .into_iter()
            .zip(points)
            .filter_map(|(face, point)| includes(point).then_some(face))
            .collect();
        if selected.is_empty() {
            Ok(None)
        } else {
            self.union_all(&selected)
        }
    }
}

fn positions(value: &Geometry, output: &mut Vec<Position>) {
    match value {
        Geometry::Point { coordinates } => output.push(*coordinates),
        Geometry::MultiPoint { coordinates } | Geometry::LineString { coordinates } => {
            output.extend(coordinates)
        }
        Geometry::MultiLineString { coordinates } | Geometry::Polygon { coordinates } => {
            output.extend(coordinates.iter().flatten())
        }
        Geometry::MultiPolygon { coordinates } => {
            output.extend(coordinates.iter().flatten().flatten())
        }
        Geometry::GeometryCollection { geometries } => {
            for geometry in geometries {
                positions(geometry, output);
            }
        }
    }
}

#[cfg(test)]
mod bounds_index_tests {
    use super::*;
    #[test]
    fn moved_features_leave_the_old_envelope_and_keep_their_identity() {
        let mut index = BoundsIndex::default();
        let west = Bounds(0., 0., 10., 10.);
        let east = Bounds(20., 5., 30., 10.);
        index.push(west);
        index.push(east);
        index.replace(0, east);
        assert!(index.query(west).is_empty());
        assert_eq!(index.query(east), [0, 1]);
    }
}
