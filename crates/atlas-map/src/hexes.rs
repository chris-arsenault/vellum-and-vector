//! Real-scale hexes and the play marks shapes leave on them (ADR 0016).
//!
//! Hexes are pointy-topped and live in world coordinates. Generation lays its shared triangular
//! lattice so these hexes group whole triangles; this module needs no lattice, so publication
//! and editing compute the same hexes and marks from published shapes alone.
use crate::{
    spatial::{Predicate, SpatialKernel, SpatialResult},
    Bounds, Geometry, MapFeature, Position,
};
use serde::{Deserialize, Serialize};
// hpc-exempt: marks are a few named shares per hex, keyed by layer kind.
use std::collections::BTreeMap;

const ROOT_THREE: f64 = 1.7320508075688772;

/// Axial address of a pointy-topped hex.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Hex {
    pub q: i32,
    pub r: i32,
}
impl Hex {
    /// The identity of this hex's feature among those `owner` publishes (a map area or a
    /// level's hex layer).
    pub fn id(self, owner: crate::Id) -> crate::Id {
        let mut name = [0; 8];
        name[..4].copy_from_slice(&self.q.to_be_bytes());
        name[4..].copy_from_slice(&self.r.to_be_bytes());
        crate::Id::v5(owner, &name)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HexGrid {
    radius: f64,
    origin: [f64; 2],
}
impl HexGrid {
    /// `radius` is centre to corner, which is also the side; `origin` is one hex centre.
    pub fn new(radius: f64, origin: [f64; 2]) -> Result<Self, &'static str> {
        if !radius.is_finite() || radius <= 0.0 || !origin.iter().all(|v| v.is_finite()) {
            return Err("A hex grid needs a positive radius and a finite origin");
        }
        Ok(Self { radius, origin })
    }
    pub fn from_across_flats(across_flats: f64, origin: [f64; 2]) -> Result<Self, &'static str> {
        Self::new(across_flats / ROOT_THREE, origin)
    }
    pub fn radius(&self) -> f64 {
        self.radius
    }
    pub fn origin(&self) -> [f64; 2] {
        self.origin
    }
    pub fn across_flats(&self) -> f64 {
        self.radius * ROOT_THREE
    }
    pub fn area(&self) -> f64 {
        1.5 * ROOT_THREE * self.radius * self.radius
    }
    pub fn hex_at(&self, [x, y]: [f64; 2]) -> Hex {
        let (x, y) = (x - self.origin[0], y - self.origin[1]);
        let q = (ROOT_THREE / 3.0 * x - y / 3.0) / self.radius;
        let r = (2.0 / 3.0 * y) / self.radius;
        round(q, r)
    }
    pub fn centre(&self, hex: Hex) -> [f64; 2] {
        let (q, r) = (f64::from(hex.q), f64::from(hex.r));
        [
            self.origin[0] + self.radius * ROOT_THREE * (q + r / 2.0),
            self.origin[1] + self.radius * 1.5 * r,
        ]
    }
    /// Corners counter-clockwise from the lower right; the first two bound the right side.
    pub fn corners(&self, hex: Hex) -> [[f64; 2]; 6] {
        let [x, y] = self.centre(hex);
        std::array::from_fn(|i| {
            let angle = (60.0 * i as f64 - 30.0).to_radians();
            [x + self.radius * angle.cos(), y + self.radius * angle.sin()]
        })
    }
    pub fn polygon(&self, hex: Hex) -> Geometry {
        let corners = self.corners(hex);
        let mut ring: Vec<_> = corners.iter().map(|&[x, y]| Position::xy(x, y)).collect();
        ring.push(ring[0]);
        Geometry::Polygon {
            coordinates: vec![ring],
        }
    }
    /// Every hex whose centre lies inside `bounds`, row by row from the south.
    pub fn covering(&self, Bounds(w, s, e, n): Bounds) -> Vec<Hex> {
        let row_height = 1.5 * self.radius;
        let first = ((s - self.origin[1]) / row_height).ceil() as i32;
        let last = ((n - self.origin[1]) / row_height).floor() as i32;
        let mut hexes = Vec::new();
        for r in first..=last {
            let shift = f64::from(r) / 2.0;
            let width = self.across_flats();
            let low = ((w - self.origin[0]) / width - shift).ceil() as i32;
            let high = ((e - self.origin[0]) / width - shift).floor() as i32;
            hexes.extend((low..=high).map(|q| Hex { q, r }));
        }
        hexes
    }
}
fn round(q: f64, r: f64) -> Hex {
    let s = -q - r;
    let (mut rq, mut rr, rs) = (q.round(), r.round(), s.round());
    let (dq, dr, ds) = ((rq - q).abs(), (rr - r).abs(), (rs - s).abs());
    if dq > dr && dq > ds {
        rq = -rr - rs;
    } else if dr > ds {
        rr = -rq - rs;
    }
    Hex {
        q: rq as i32,
        r: rr as i32,
    }
}

/// A published shape and the play mark it leaves on the hexes it covers or crosses.
pub struct MarkSource<'a> {
    pub geometry: &'a Geometry,
    pub mark: &'a str,
}
/// Per hex, each mark's share: the covered fraction for areas, 1 for a line or point present.
pub fn marks(
    grid: &HexGrid,
    hexes: &[Hex],
    sources: &[MarkSource<'_>],
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Vec<BTreeMap<String, f64>>> {
    let polygons: Vec<_> = hexes.iter().map(|&hex| grid.polygon(hex)).collect();
    let mut result = vec![BTreeMap::new(); hexes.len()];
    if polygons.is_empty() {
        return Ok(result);
    }
    let index = spatial.index(&polygons)?;
    let area = grid.area();
    for source in sources {
        let candidates = index.query(spatial.bounds(source.geometry)?)?;
        if candidates.is_empty() {
            continue;
        }
        let shapes: Vec<_> = candidates.iter().map(|&i| polygons[i].clone()).collect();
        let shares = if is_area(source.geometry) {
            spatial
                .intersection_areas(source.geometry, &shapes)?
                .into_iter()
                .map(|covered| covered / area)
                .collect()
        } else {
            spatial
                .relations(source.geometry, &shapes, Predicate::Intersects)?
                .into_iter()
                .map(|hit| if hit { 1.0 } else { 0.0 })
                .collect::<Vec<_>>()
        };
        for (&i, share) in candidates.iter().zip(shares) {
            if share > 0.0 {
                let entry = result[i].entry(source.mark.to_owned()).or_insert(0.0);
                *entry = (*entry + share).min(1.0);
            }
        }
    }
    Ok(result)
}
/// The play mark a published layer leaves on the hexes it covers or crosses.
pub fn mark_of(layer_id: &str) -> Option<&'static str> {
    match crate::authoring::family(layer_id) {
        "rivers" | "lakes" | "oceans" | "waterworks" => Some("water"),
        "roads" => Some("way"),
        "plots" => Some("plot"),
        "structures" | "ruins" => Some("structure"),
        "objects" => Some("object"),
        // Cave shapes mark the underground grid; an entrance marks the surface hex it opens in.
        "caves" | "caveEntrances" => Some("cave"),
        // A drawn cave wall marks the underground hexes it runs through.
        "caveWalls" => Some("wall"),
        _ => None,
    }
}
/// The mark exposed rock leaves, and the ground class of a hex it covers for the most part.
pub const ROCK_MARK: &str = "rock";
pub const EXPOSED_ROCK: &str = "Exposed rock";
/// The ground a published feature covers: its footprint when it has one, else its geometry.
/// Outcrops mark the rock they bare, whatever layer holds them.
pub fn mark_shape(feature: &MapFeature) -> Option<(Geometry, &'static str)> {
    let mark = if feature.kind == "outcrop" {
        ROCK_MARK
    } else {
        mark_of(&feature.layer_id)?
    };
    let shape = feature
        .footprint
        .as_ref()
        .map(crate::regions::as_geometry)
        .unwrap_or_else(|| feature.geometry.clone());
    Some((shape, mark))
}
/// The mark that covers most of a hex; areas outrank a line or point only when they cover more.
pub fn fill(marks: &BTreeMap<String, f64>) -> Option<&str> {
    marks
        .iter()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map(|(mark, _)| mark.as_str())
}
/// The ground a line covers when it states a full width at each vertex (`widths`); a line
/// whose widths no longer match its vertices, or any other shape, has no footprint.
pub fn widened_footprint(
    geometry: &Geometry,
    widths: Option<&serde_json::Value>,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Option<Geometry>> {
    let (Geometry::LineString { coordinates }, Some(widths)) =
        (geometry, widths.and_then(|w| w.as_array()))
    else {
        return Ok(None);
    };
    let widths: Option<Vec<f64>> = widths.iter().map(serde_json::Value::as_f64).collect();
    match widths {
        Some(widths) if widths.len() == coordinates.len() => {
            width_outline(coordinates, &widths, spatial)
        }
        _ => Ok(None),
    }
}
fn is_area(geometry: &Geometry) -> bool {
    matches!(
        geometry,
        Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }
    )
}

/// The ground a line covers when its width can change at every vertex: segment strips joined
/// by round vertices. `widths` holds one full width per vertex.
pub fn width_outline(
    line: &[Position],
    widths: &[f64],
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Option<Geometry>> {
    if line.len() < 2 || widths.len() != line.len() {
        return Err("A widened line needs two or more vertices and one width for each".into());
    }
    if widths.iter().any(|w| !w.is_finite() || *w <= 0.0) {
        return Err("Line widths must be positive".into());
    }
    let points: Vec<[f64; 2]> = line
        .iter()
        .map(|p| {
            let [x, y, _] = p.coordinates();
            [x, y]
        })
        .collect();
    let mut parts = Vec::new();
    for (i, pair) in points.windows(2).enumerate() {
        let ([ax, ay], [bx, by]) = (pair[0], pair[1]);
        let length = (bx - ax).hypot(by - ay);
        if length == 0.0 {
            continue;
        }
        let (nx, ny) = (-(by - ay) / length, (bx - ax) / length);
        let (ha, hb) = (widths[i] / 2.0, widths[i + 1] / 2.0);
        parts.extend(ring(&[
            [ax + nx * ha, ay + ny * ha],
            [bx + nx * hb, by + ny * hb],
            [bx - nx * hb, by - ny * hb],
            [ax - nx * ha, ay - ny * ha],
        ]));
    }
    for (point, width) in points.iter().zip(widths) {
        parts.extend(disc(*point, width / 2.0));
    }
    if parts.is_empty() {
        return Ok(None);
    }
    spatial.union_all(&parts)
}
fn ring(corners: &[[f64; 2]]) -> Option<Geometry> {
    // A narrow track's left and right edges can coincide at world coordinates.
    // A convex strip or cap contributes a surface only if it spans a triangle.
    let [x, y] = corners[0];
    if !corners[1..].windows(2).any(|pair| {
        let [a, b] = [pair[0], pair[1]];
        (a[0] - x) * (b[1] - y) != (a[1] - y) * (b[0] - x)
    }) {
        return None;
    }
    let mut ring: Vec<_> = corners.iter().map(|&[x, y]| Position::xy(x, y)).collect();
    ring.push(ring[0]);
    Some(Geometry::Polygon {
        coordinates: vec![ring],
    })
}
fn disc([x, y]: [f64; 2], radius: f64) -> Option<Geometry> {
    let corners: Vec<_> = (0..16)
        .map(|i| {
            let angle = f64::from(i) * std::f64::consts::TAU / 16.0;
            [x + radius * angle.cos(), y + radius * angle.sin()]
        })
        .collect();
    ring(&corners)
}
