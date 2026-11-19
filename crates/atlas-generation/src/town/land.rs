//! Retained working plots are cut by actual access and competing built claims.
use super::catalogue::PlaceRules;
use super::{
    edits::line,
    fabric::{polygon, Fabric},
    geometry::{add, left, rectangle, scale, sub, unit, Jitter, Point},
    ground::{Ground, OUTSIDE, STEEP, WATER},
    settings,
};
use crate::spatial::SpatialKernel;
use atlas_map::{spatial::Overlay, Bounds, Geometry, Position};
use serde::{Deserialize, Serialize};
use std::io;
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
pub fn establish(
    bounds: [f64; 4],
    ways: &[Geometry],
    key: &str,
    share: impl Fn(Point) -> io::Result<(f64, f64)>,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<Field>> {
    let [w, s, e, n] = bounds;
    let mut jitter = Jitter::new(key);
    let mut sites = Vec::new();
    let mut y = s + settings::FIELD_BLOCK * 0.4;
    while y < n {
        let mut x = w + settings::FIELD_BLOCK * 0.4;
        while x < e {
            sites.push(Position::xy(
                x + jitter.around(0., settings::FIELD_BLOCK * 0.25),
                y + jitter.around(0., settings::FIELD_BLOCK * 0.25),
            ));
            x += settings::FIELD_BLOCK;
        }
        y += settings::FIELD_BLOCK * 0.85;
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
        let direction = match index.nearest(point).map_err(io::Error::other)? {
            Some(i) => tangent(&ways[i], point, spatial)?,
            None => [1., 0.],
        };
        let shapes = if pasture > farm {
            vec![shape]
        } else {
            strips(&shape, at, direction, spatial)?
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
) -> io::Result<Vec<Geometry>> {
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
            settings::FIELD_STRIP - 1.,
            reach * 2.,
        ));
        if let Some(clipped) = spatial
            .overlay(shape, &strip, Overlay::Intersection)
            .map_err(io::Error::other)?
            .and_then(atlas_map::regions::polygon)
        {
            result.push(clipped);
        }
        offset += settings::FIELD_STRIP;
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
    let mut excluded: Vec<_> = fabric
        .towns
        .iter()
        .flat_map(|t| t.holdings().iter().map(|h| h.outline.clone()))
        .collect();
    for (points, width) in ways {
        if let Some(mask) = spatial
            .buffer(&line(points), width / 2. + 1.)
            .map_err(io::Error::other)?
        {
            excluded.push(mask);
        }
    }
    for street in fabric.towns.iter().flat_map(|town| town.streets()) {
        if let Some(mask) = street.corridor(1., spatial).map_err(io::Error::other)? {
            excluded.push(mask);
        }
    }
    exclude_unworkable_ground(ground, &mut excluded);
    if !excluded.is_empty() {
        if let Some(mask) = spatial
            .union_all(&excluded)
            .map_err(io::Error::other)?
            .and_then(atlas_map::regions::polygon)
        {
            let plots: Vec<_> = fabric.fields.iter().map(|f| f.outline.clone()).collect();
            let fitted = spatial
                .overlays(&mask, &plots, Overlay::Difference)
                .map_err(io::Error::other)?;
            for (field, result) in fabric.fields.iter_mut().zip(fitted) {
                if let Some(outline) = result.and_then(atlas_map::regions::polygon) {
                    field.outline = outline;
                } else {
                    field.suitability = 0.;
                }
            }
        }
    }
    fabric.fields.retain(|f| f.suitability > 0.);
    assign(fabric, ground, spatial)?;
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
    for town in &fabric.towns {
        let access = super::access::Access::for_town(town, spatial)?.on_ground(ground);
        let farms: Vec<_> = town
            .holdings()
            .iter()
            .filter(|h| h.kind.definition().roles.works_fields && h.occupation > 0.2)
            .collect();
        let origins: Vec<_> = farms.iter().map(|h| h.slot.front).collect();
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
                let labour = farm.occupation * farm.condition * (0.5 + farm.means)
                    / (1. + cost / settings::FIELD_BLOCK);
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
