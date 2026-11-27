//! Retained working plots are cut by actual access and competing built claims.
use super::catalogue::PlaceRules;
use super::{
    edits::line,
    fabric::{polygon, Fabric},
    geometry::{add, left, rectangle, scale, sub, unit, Jitter, Point},
    ground::{Ground, OUTSIDE, STEEP, WATER},
    scale::{Measure, TownScale},
    settings,
};
use crate::spatial::SpatialKernel;
use atlas_map::{spatial::Overlay, Bounds, Geometry, Position};
use serde::{Deserialize, Serialize};
use std::io;
/// The balk left between neighbouring ploughed strips, and the ground a field keeps clear of
/// a way's or street's edge. Street metres, resolved by `Measure::Plot`.
const STRIP_BALK: f64 = 1.;
const WAY_VERGE: f64 = 1.;
#[derive(Serialize, Deserialize)]
pub struct Field {
    pub id: u32,
    pub estate: u32,
    pub outline: Geometry,
    pub pasture: bool,
    pub worked: f64,
    pub suitability: f64,
    pub opening_cost: f64,
    pub worked_by: Option<Worker>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Worker {
    pub town: atlas_map::Id,
    pub holding: super::fabric::HoldingId,
}
/// The map's fields, laid out in blocks and strips sized at `town_scale`.
pub fn establish(
    bounds: [f64; 4],
    ways: &[Geometry],
    key: &str,
    share: impl Fn(Point) -> io::Result<(f64, f64)>,
    spatial: &dyn SpatialKernel,
    town_scale: TownScale,
) -> io::Result<Vec<Field>> {
    let [w, s, e, n] = bounds;
    let block = town_scale.length(settings::FIELD_BLOCK, Measure::Plot);
    let mut jitter = Jitter::new(key);
    let mut sites = Vec::new();
    let mut y = s + block * 0.4;
    while y < n {
        let mut x = w + block * 0.4;
        while x < e {
            sites.push(Position::xy(
                x + jitter.around(0., block * 0.25),
                y + jitter.around(0., block * 0.25),
            ));
            x += block;
        }
        y += block * 0.85;
    }
    if sites.is_empty() {
        return Ok(vec![]);
    }
    let cells = spatial
        .voronoi_cells(&sites, Bounds(w, s, e, n))
        .map_err(io::Error::other)?;
    let index = spatial.index(ways).map_err(io::Error::other)?;
    let mut fields = Vec::new();
    for (estate, (point, shape)) in sites.into_iter().zip(cells).enumerate() {
        let [x, y, _] = point.coordinates();
        let at = [x, y];
        let (farm, pasture) = share(at)?;
        if farm + pasture <= jitter.sample() * 0.4 {
            continue;
        }
        let Some(shape) = shape else { continue };
        let shapes = if pasture > farm {
            vec![shape]
        } else {
            let direction = field_frontage(&shape, point, ways, index.as_ref(), spatial)?;
            strips(&shape, at, direction, spatial, town_scale)?
        };
        for outline in shapes {
            fields.push(Field {
                id: fields.len() as u32,
                estate: estate as u32,
                outline,
                pasture: pasture > farm,
                worked: (farm + pasture).min(1.),
                suitability: (farm + pasture).min(1.),
                opening_cost: jitter.sample(),
                worked_by: None,
            });
        }
    }
    Ok(fields)
}
/// Strips open onto a way that crosses their estate. Away from roads, run
/// their long sides along the longest estate boundary.
fn field_frontage(
    shape: &Geometry,
    centre: Position,
    ways: &[Geometry],
    index: &dyn crate::spatial::SpatialIndex,
    spatial: &dyn SpatialKernel,
) -> io::Result<Point> {
    let at = atlas_map::regions::point(centre);
    let mut closest = None;
    for i in index
        .query(spatial.bounds(shape).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
    {
        if spatial
            .relation(shape, &ways[i], crate::spatial::Predicate::Intersects)
            .map_err(io::Error::other)?
        {
            let gap = spatial.distance(&ways[i], &at).map_err(io::Error::other)?;
            if closest.is_none_or(|(best, _)| gap < best) {
                closest = Some((gap, i));
            }
        }
    }
    if let Some((_, i)) = closest {
        return tangent(&ways[i], centre, spatial);
    }
    let edges = atlas_map::regions::boundary_lines(shape);
    let direction = edges
        .iter()
        .flat_map(|ring| ring.windows(2))
        .map(|edge| {
            let [x, y, _] = edge[0].coordinates();
            let [u, v, _] = edge[1].coordinates();
            [u - x, v - y]
        })
        .max_by(|a, b| super::geometry::length(*a).total_cmp(&super::geometry::length(*b)));
    Ok(left(unit(direction.unwrap_or([1., 0.]))))
}
fn tangent(way: &Geometry, point: Position, spatial: &dyn SpatialKernel) -> io::Result<Point> {
    let fraction = spatial
        .line_fraction(way, point)
        .map_err(io::Error::other)?;
    let a = spatial
        .line_at(way, (fraction - 0.01).max(0.))
        .map_err(io::Error::other)?
        .coordinates();
    let b = spatial
        .line_at(way, (fraction + 0.01).min(1.))
        .map_err(io::Error::other)?
        .coordinates();
    Ok(unit(sub([b[0], b[1]], [a[0], a[1]])))
}

fn strips(
    shape: &Geometry,
    at: Point,
    direction: Point,
    spatial: &dyn SpatialKernel,
    town_scale: TownScale,
) -> io::Result<Vec<Geometry>> {
    let strip_width = town_scale.length(settings::FIELD_STRIP, Measure::Plot);
    let balk = town_scale.length(STRIP_BALK, Measure::Plot);
    let Bounds(w, s, e, n) = spatial.bounds(shape).map_err(io::Error::other)?;
    let reach = (e - w).hypot(n - s);
    let mut offset = -reach;
    let mut result = Vec::new();
    while offset < reach {
        let start = add(
            add(at, scale(direction, offset)),
            scale(left(direction), -reach),
        );
        let strip = polygon(&rectangle(
            start,
            direction,
            left(direction),
            strip_width - balk,
            reach * 2.,
        ));
        if let Some(clipped) = spatial
            .overlay(shape, &strip, Overlay::Intersection)
            .map_err(io::Error::other)?
            .and_then(atlas_map::regions::polygon)
        {
            result.push(clipped);
        }
        offset += strip_width;
    }
    Ok(result)
}
pub fn develop(
    fabric: &mut Fabric,
    ways: &[(Vec<Point>, f64)],
    ground: &Ground,
    spatial: &dyn SpatialKernel,
) -> io::Result<()> {
    fabric.fields.append(&mut fabric.fallow);
    if fabric.fields.is_empty() {
        return Ok(());
    }
    let verge = fabric.scale().length(WAY_VERGE, Measure::Plot);
    let mut excluded: Vec<_> = fabric
        .towns
        .iter()
        .flat_map(|t| t.holdings().iter().map(|h| h.outline.clone()))
        .collect();
    excluded.extend(
        fabric
            .towns
            .iter()
            .filter_map(|town| town.district.as_ref())
            .flat_map(|district| district.reserves.iter().cloned()),
    );
    for (points, width) in ways {
        if let Some(mask) = spatial
            .buffer(&line(points), width / 2. + verge)
            .map_err(io::Error::other)?
        {
            excluded.push(mask);
        }
    }
    for street in fabric.towns.iter().flat_map(|town| town.streets()) {
        if let Some(mask) = street.corridor(verge, spatial).map_err(io::Error::other)? {
            excluded.push(mask);
        }
    }
    exclude_unworkable_ground(ground, &mut excluded);
    fit_fields(&mut fabric.fields, &excluded, spatial)?;
    fabric.fields.retain(|f| f.suitability > 0.);
    assign(fabric, ground, spatial)?;
    Ok(())
}
/// Strips in one farm estate share an exclusion mask. A street or building
/// elsewhere in the district cannot remove cropland from this estate.
fn fit_fields(
    fields: &mut [Field],
    excluded: &[Geometry],
    spatial: &dyn SpatialKernel,
) -> io::Result<()> {
    if excluded.is_empty() {
        return Ok(());
    }
    let mut obstructions = atlas_map::spatial::BoundsIndex::default();
    for shape in excluded {
        obstructions.push(spatial.bounds(shape).map_err(io::Error::other)?);
    }
    // hpc-exempt: group retained field geometries by their estate identity.
    let mut estates = std::collections::BTreeMap::<u32, (Bounds, Vec<usize>)>::new();
    for (i, field) in fields.iter().enumerate() {
        let bounds = spatial.bounds(&field.outline).map_err(io::Error::other)?;
        let (extent, members) = estates
            .entry(field.estate)
            .or_insert_with(|| (bounds, Vec::new()));
        *extent = Bounds(
            extent.0.min(bounds.0),
            extent.1.min(bounds.1),
            extent.2.max(bounds.2),
            extent.3.max(bounds.3),
        );
        members.push(i);
    }
    for (extent, members) in estates.into_values() {
        let nearby: Vec<_> = obstructions
            .query(extent)
            .into_iter()
            .map(|i| excluded[i].clone())
            .collect();
        if nearby.is_empty() {
            continue;
        }
        let Some(mask) = spatial.union_all(&nearby).map_err(io::Error::other)? else {
            continue;
        };
        let strips: Vec<_> = members.iter().map(|&i| fields[i].outline.clone()).collect();
        let fitted = spatial
            .overlays(&mask, &strips, Overlay::Difference)
            .map_err(io::Error::other)?;
        for (i, result) in members.into_iter().zip(fitted) {
            if let Some(outline) = result.and_then(atlas_map::regions::polygon) {
                fields[i].outline = outline;
            } else {
                fields[i].suitability = 0.;
            }
        }
    }
    Ok(())
}
fn exclude_unworkable_ground(ground: &Ground, excluded: &mut Vec<Geometry>) {
    // Adjacent unavailable squares in one row form a single rectangle.
    for row in 0..ground.rows {
        let mut col = 0;
        while col < ground.columns {
            let start = col;
            while col < ground.columns
                && matches!(
                    ground.owner_at(row * ground.columns + col),
                    WATER | STEEP | OUTSIDE
                )
            {
                col += 1;
            }
            if col == start {
                col += 1;
                continue;
            }
            let width = (col - start) as f64 * ground.cell;
            let x = ground.origin[0] + start as f64 * ground.cell;
            let y = ground.origin[1] + row as f64 * ground.cell;
            excluded.push(polygon(&rectangle(
                [x + width / 2., y],
                [1., 0.],
                [0., 1.],
                width,
                ground.cell,
            )));
        }
    }
}
fn assign(fabric: &mut Fabric, ground: &Ground, spatial: &dyn SpatialKernel) -> io::Result<()> {
    if fabric.fields.is_empty() {
        return Ok(());
    }
    let outlines: Vec<_> = fabric.fields.iter().map(|f| f.outline.clone()).collect();
    let positions = spatial.interiors(&outlines).map_err(io::Error::other)?;
    let targets: Vec<_> = positions
        .iter()
        .map(|p| {
            let [x, y, _] = p.coordinates();
            [x, y]
        })
        .collect();
    let mut best = vec![(0., None); fabric.fields.len()];
    // A farm's labour fades with the walk to its fields, over a field block's walk.
    let walk = fabric
        .scale()
        .length(settings::FIELD_BLOCK, Measure::Travel);
    for town in &fabric.towns {
        let farms: Vec<_> = town
            .holdings()
            .iter()
            .filter(|h| h.kind.definition().roles.works_fields && h.occupation > 0.2)
            .collect();
        let origins: Vec<_> = farms.iter().map(|h| h.slot.front).collect();
        if origins.is_empty() {
            continue;
        }
        let access = super::access::Access::for_town(town, spatial)?.on_ground(ground);
        let routes = access.travel_costs(&origins, &targets, spatial)?;
        for (farm, costs) in farms.into_iter().zip(routes) {
            let worker = Worker {
                town: town.seat.key,
                holding: farm.id,
            };
            for ((best, field), cost) in best.iter_mut().zip(&fabric.fields).zip(costs) {
                let cost = cost
                    * if field.worked_by.as_ref() == Some(&worker) {
                        0.7
                    } else {
                        1.
                    };
                let labour =
                    farm.occupation * farm.condition * (0.5 + farm.means) / (1. + cost / walk);
                if labour > best.0 {
                    *best = (labour, Some(worker.clone()));
                }
            }
        }
    }
    let fields = std::mem::take(&mut fabric.fields);
    for (mut field, (labour, worker)) in fields.into_iter().zip(best) {
        let local = field.suitability / (1. + field.suitability);
        let support = local + labour * (0.5 + local);
        let continuity = 0.08 * field.worked;
        if support + continuity > field.opening_cost {
            field.worked = support.min(1.);
            field.worked_by = if labour + continuity > field.opening_cost * 0.5 {
                worker
            } else {
                None
            };
            fabric.fields.push(field);
        } else {
            field.worked = 0.;
            field.worked_by = None;
            fabric.fallow.push(field);
        }
    }
    Ok(())
}

#[cfg(test)]
mod field_tests {
    use super::*;

    #[test]
    fn field_strips_face_a_local_road_or_follow_the_estate_boundary() {
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let estate = atlas_map::regions::rectangle(Bounds(0., 0., 100., 30.));
        let centre = Position::xy(50., 15.);
        let remote = line(&[[0., 100.], [100., 100.]]);
        let index = spatial.index(std::slice::from_ref(&remote)).unwrap();
        let front = field_frontage(
            &estate,
            centre,
            std::slice::from_ref(&remote),
            index.as_ref(),
            &spatial,
        )
        .unwrap();
        assert!(front[1].abs() > 0.99);
        let ways = [remote, line(&[[0., 1.], [90., 10.]])];
        let index = spatial.index(&ways).unwrap();
        let front = field_frontage(&estate, centre, &ways, index.as_ref(), &spatial).unwrap();
        assert!(front[0] > 0.99 && front[1] > 0.);
    }
}
