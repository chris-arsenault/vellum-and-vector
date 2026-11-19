//! Indexed geometry queries and site construction use standard R-tree and GEOS operations.
use crate::geometry::NativeGeos;
use atlas_map::spatial::{SpatialIndex, SpatialResult};
use atlas_map::{Bounds, Geometry, Position};
use geos::{Geom, Geometry as Native};
use rstar::{
    primitives::{GeomWithData, Rectangle},
    PointDistance, RTree, AABB,
};
use std::collections::BTreeMap;

type EnvelopeItem = GeomWithData<Rectangle<[f64; 2]>, usize>;
pub(crate) struct NativeIndex<'a> {
    spatial: &'a NativeGeos,
    tree: RTree<EnvelopeItem>,
    geometries: Vec<Native>,
}
impl<'a> NativeIndex<'a> {
    pub(crate) fn new(spatial: &'a NativeGeos, values: &[Geometry]) -> SpatialResult<Self> {
        let geometries = values
            .iter()
            .map(|v| spatial.read(v))
            .collect::<SpatialResult<Vec<_>>>()?;
        let mut entries = Vec::new();
        for (i, shape) in geometries.iter().enumerate() {
            let e = shape.get_extent().map_err(|e| e.to_string())?;
            entries.push(GeomWithData::new(
                Rectangle::from_corners([e[0], e[1]], [e[2], e[3]]),
                i,
            ));
        }
        Ok(Self {
            spatial,
            tree: RTree::bulk_load(entries),
            geometries,
        })
    }
}
fn envelope(bounds: Bounds) -> SpatialResult<AABB<[f64; 2]>> {
    if ![bounds.0, bounds.1, bounds.2, bounds.3]
        .iter()
        .all(|v| v.is_finite())
        || bounds.0 > bounds.2
        || bounds.1 > bounds.3
    {
        return Err("Index bounds must be finite and ordered".into());
    }
    Ok(AABB::from_corners(
        [bounds.0, bounds.1],
        [bounds.2, bounds.3],
    ))
}
impl SpatialIndex for NativeIndex<'_> {
    fn query(&self, bounds: Bounds) -> SpatialResult<Vec<usize>> {
        let mut hits: Vec<_> = self
            .tree
            .locate_in_envelope_intersecting(envelope(bounds)?)
            .map(|entry| entry.data)
            .collect();
        hits.sort_unstable();
        Ok(hits)
    }
    fn distances(&self, bounds: Bounds, position: Position) -> SpatialResult<Vec<(usize, f64)>> {
        let point = self.spatial.native_point(position)?;
        self.query(bounds)?
            .into_iter()
            .map(|i| {
                let distance = self.geometries[i]
                    .distance(&point)
                    .map_err(|e| e.to_string())?;
                Ok((i, distance))
            })
            .collect()
    }
    fn nearest_with_distance(&self, position: Position) -> SpatialResult<Option<(usize, f64)>> {
        let point = self.spatial.native_point(position)?;
        let xy = [
            point.get_x().map_err(|e| e.to_string())?,
            point.get_y().map_err(|e| e.to_string())?,
        ];
        let mut best = None;
        let mut distance = f64::INFINITY;
        // Envelope distance is a lower bound. The R-tree stops before unrelated geometry is read.
        for candidate in self.tree.nearest_neighbor_iter(xy) {
            if candidate.distance_2(&xy) > distance * distance {
                break;
            }
            let actual = self.geometries[candidate.data]
                .distance(&point)
                .map_err(|e| e.to_string())?;
            if actual < distance {
                best = Some(candidate.data);
                distance = actual;
            }
        }
        Ok(best.map(|i| (i, distance)))
    }
}

fn site_key(position: Position) -> (u64, u64) {
    let [x, y, _] = position.coordinates();
    let key = |v: f64| {
        if v == 0.0 {
            0
        } else {
            v.to_bits()
        }
    };
    (key(x), key(y))
}
pub(crate) fn delaunay(
    spatial: &NativeGeos,
    points: &[Position],
) -> SpatialResult<Vec<[usize; 2]>> {
    // Index the coordinates actually supplied to GEOS. A separately rounded key
    // can disagree with GEOS precision reduction at a grid boundary.
    let points = points
        .iter()
        .map(|p| spatial.read(&Geometry::Point { coordinates: *p }))
        .collect::<SpatialResult<Vec<_>>>()?;
    let indices: BTreeMap<_, _> = points
        .iter()
        .enumerate()
        .map(|(i, p)| {
            Ok((
                site_key(Position::xy(
                    p.get_x().map_err(|e| e.to_string())?,
                    p.get_y().map_err(|e| e.to_string())?,
                )),
                i,
            ))
        })
        .collect::<SpatialResult<_>>()?;
    if indices.len() < 2 {
        return Ok(Vec::new());
    }
    let input = Native::create_multipoint(points).map_err(|e| e.to_string())?;
    let edges = NativeGeos::json(
        input
            .delaunay_triangulation(0.0, true)
            .map_err(|e| e.to_string())?,
    )?;
    let Some(Geometry::MultiLineString { coordinates }) = edges else {
        return Err("Could not connect geographic sites".into());
    };
    coordinates
        .into_iter()
        .map(|edge| {
            if edge.len() != 2 {
                return Err("A Delaunay edge needs two sites".into());
            }
            let index = |p| {
                indices
                    .get(&site_key(p))
                    .copied()
                    .ok_or_else(|| String::from("GEOS returned an unknown site"))
            };
            Ok([index(edge[0])?, index(edge[1])?])
        })
        .collect()
}
fn rectangle(bounds: Bounds) -> SpatialResult<Geometry> {
    envelope(bounds)?;
    let Bounds(x0, y0, x1, y1) = bounds;
    Ok(Geometry::Polygon {
        coordinates: vec![vec![
            Position::xy(x0, y0),
            Position::xy(x1, y0),
            Position::xy(x1, y1),
            Position::xy(x0, y1),
            Position::xy(x0, y0),
        ]],
    })
}
pub(crate) fn voronoi(
    spatial: &NativeGeos,
    sites: &[Position],
    bounds: Bounds,
) -> SpatialResult<Vec<Option<Geometry>>> {
    if sites.is_empty() {
        return Ok(Vec::new());
    }
    let clip = spatial.read(&rectangle(bounds)?)?;
    let input = spatial.read(&Geometry::MultiPoint {
        coordinates: sites.to_vec(),
    })?;
    let cells = input
        .voronoi(Some(&clip), 0.0, false)
        .map_err(|e| e.to_string())?;
    let Some(Geometry::GeometryCollection { geometries }) = NativeGeos::json(cells)? else {
        return Ok(vec![None; sites.len()]);
    };
    let index = NativeIndex::new(spatial, &geometries)?;
    sites
        .iter()
        .map(|p| site_cell(spatial, &index, *p, &clip))
        .collect()
}
fn site_cell(
    spatial: &NativeGeos,
    index: &NativeIndex<'_>,
    position: Position,
    clip: &Native,
) -> SpatialResult<Option<Geometry>> {
    let point = spatial.native_point(position)?;
    let x = point.get_x().map_err(|e| e.to_string())?;
    let y = point.get_y().map_err(|e| e.to_string())?;
    for i in index.query(Bounds(x, y, x, y))? {
        let cell = &index.geometries[i];
        if cell.intersects(&point).map_err(|e| e.to_string())? {
            return NativeGeos::json(
                cell.intersection_prec(clip, spatial.precision)
                    .map_err(|e| e.to_string())?,
            );
        }
    }
    Ok(None)
}
