use super::{code, ground, metres, read, Field, PhysicalContext, Settings, C, G, S};
use crate::{
    metric::search::search,
    rock::{
        catalogue,
        ground::query::{average, GroundQuery},
        material_gives, ModeId, ModeMix,
    },
    storage::Band,
};
use std::{collections::VecDeque, io};
pub(super) struct Component {
    pub id: usize,
    pub code: i32,
    pub pair: i32,
    pub count: usize,
    pub area: f64,
    pub shortening: f64,
    pub collision: f64,
    pub suture: f64,
    pub strain: f64,
    pub continental: f64,
    pub maximum_continental: f64,
    pub front_sheet: i32,
    pub salt: i32,
    pub position: [f64; 2],
}
pub(super) struct Frame {
    pub distance: Band<f64>,
    pub source: Band<i32>,
    pub reach: Band<f64>,
    pub overlap: Band<f64>,
}
fn active(field: &Field, p: &Settings, cell: usize) -> io::Result<bool> {
    Ok(code(field, C::TectonicBoundaryCodes, cell)? != 0
        && read(field, S::TectonicStrain, cell)? >= p.orogenic_minimum_strain)
}
fn flood(
    field: &Field,
    p: &Settings,
    ids: &mut Band<i32>,
    c: &mut Component,
    start: usize,
) -> io::Result<()> {
    let mut queue = VecDeque::from([start]);
    let origin = field.mesh.position(start)[0];
    while let Some(cell) = queue.pop_front() {
        let area = field.mesh.area(cell);
        let fraction = ground(field, G::CrustContinentalFraction, cell)?;
        let at = field.mesh.position(cell);
        c.count += 1;
        c.area += area;
        c.collision += read(field, S::CrustCollisionIntensity, cell)? * area;
        c.suture += ground(field, G::CrustSutureStrength, cell)? * area;
        c.strain += read(field, S::TectonicStrain, cell)? * area;
        c.continental += fraction * area;
        c.maximum_continental = c.maximum_continental.max(fraction / 1000.0);
        c.shortening += metres(read(field, S::ConvergentCrustSurplus, cell)?).round() * area;
        c.position[0] += (origin + field.mesh.delta_x(at[0] - origin)) * area;
        c.position[1] += at[1] * area;
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if ids.get(next)? >= 0
                || code(field, C::TectonicBoundaryCodes, next)? != c.code
                || code(field, C::TectonicBoundaryPairIds, next)? != c.pair
                || !active(field, p, next)?
            {
                continue;
            }
            ids.set(next, c.id as i32)?;
            queue.push_back(next);
        }
    }
    c.collision /= c.area * 1000.0;
    c.suture /= c.area * 1000.0;
    c.strain /= c.area * 1000.0;
    c.continental /= c.area * 1000.0;
    c.position = field.mesh.point(
        (c.position[0] / c.area).round(),
        (c.position[1] / c.area).round(),
    );
    Ok(())
}
pub(super) fn discover(
    field: &Field,
    p: &Settings,
    context: &PhysicalContext,
    ids: &mut Band<i32>,
) -> io::Result<Vec<Component>> {
    let mut result = Vec::new();
    for cell in 0..field.mesh.len() {
        if ids.get(cell)? >= 0 || !active(field, p, cell)? {
            continue;
        }
        let pair = code(field, C::TectonicBoundaryPairIds, cell)?;
        let mut c = Component {
            id: result.len(),
            code: code(field, C::TectonicBoundaryCodes, cell)?,
            pair,
            count: 0,
            area: 0.0,
            shortening: 0.0,
            collision: 0.0,
            suture: 0.0,
            strain: 0.0,
            continental: 0.0,
            maximum_continental: 0.0,
            front_sheet: -1,
            salt: context.epoch_stable_seed ^ pair,
            position: [0.0; 2],
        };
        ids.set(cell, c.id as i32)?;
        flood(field, p, ids, &mut c, cell)?;
        result.push(c);
    }
    Ok(result)
}
pub(super) fn across(field: &Field, cell: usize, source: usize) -> io::Result<f64> {
    let mut tx = read(field, S::TectonicTangentX, source)? / 1000.0;
    let mut ty = read(field, S::TectonicTangentY, source)? / 1000.0;
    if tx.abs() + ty.abs() < 0.01 {
        tx = 1.0;
        ty = 0.0;
    }
    let at = field.mesh.position(cell);
    let from = field.mesh.position(source);
    Ok(-field.mesh.delta_x(at[0] - from[0]) * ty + (at[1] - from[1]) * tx)
}
pub(super) fn influence(
    field: &mut Field,
    p: &Settings,
    components: &[Component],
    ids: &Band<i32>,
) -> io::Result<Frame> {
    let n = field.mesh.len();
    let coverage = field.coverage.get_mut();
    let mut distance = coverage.scratch(n, f64::INFINITY);
    let mut source = coverage.scratch(n, -1i32);
    let mut reach = coverage.scratch(n, 0.0);
    let mut resistance = coverage.scratch(n, 0.0);
    let overlap = coverage.scratch(n, 0.0);
    let shear = catalogue::compile(ModeMix::default().with(ModeId::Shear, 1.0));
    let mut yielding = GroundQuery::new(0.0f64);
    yielding.through_column = true;
    yielding.rock = Some(Box::new(move |best, layer, _| {
        best.max(material_gives(
            &shear,
            &layer.material.interaction(),
            false,
            [0.0; 2],
        ))
    }));
    let yielding = average(yielding);
    let mut seeds = Vec::new();
    for cell in 0..n {
        let response = field.ground().fold(cell, &yielding, None)?;
        let thickness = ground(field, G::CrustThickness, cell)?;
        let load = if thickness > 0.0 {
            ground(field, G::SurfaceRockLoad, cell)? / thickness
        } else {
            0.0
        };
        resistance.set(
            cell,
            if response > 0.0 {
                (1.0 + load.max(0.0)) / response
            } else {
                f64::INFINITY
            },
        )?;
        let id = ids.get(cell)?;
        if id < 0
            || components[id as usize].code != 1
            || components[id as usize].area < p.orogenic_minimum_component_area
        {
            continue;
        }
        field
            .shared
            .code_mut(C::OrogenicComponentIds)
            .set(cell, id)?;
        distance.set(cell, 0.0)?;
        source.set(cell, cell as i32)?;
        seeds.push(cell);
    }
    let component_ids = field.shared.code_mut(C::OrogenicComponentIds);
    search(
        &field.mesh,
        seeds,
        &mut distance,
        f64::INFINITY,
        |next, cell| {
            source.set(next, source.get(cell)?)?;
            component_ids.set(next, component_ids.get(cell)?)?;
            reach.set(
                next,
                reach.get(cell)? + field.mesh.physical_distance(cell, next),
            )
        },
        |cell, next, edge| {
            Ok(field.mesh.edge_length(cell, edge)
                * (resistance.get(cell)? + resistance.get(next)?)
                / 2.0)
        },
    )?;
    let mut fronts = vec![0.0f64; components.len()];
    for cell in 0..n {
        let id = code(field, C::OrogenicComponentIds, cell)?;
        if id >= 0
            && ground(field, G::ThrustPairIds, cell)?
                == f64::from(components[id as usize].pair) + 1.0
        {
            fronts[id as usize] = fronts[id as usize].max(distance.get(cell)?);
        }
    }
    let drift = if field.crust_formed {
        field.last_plate_drift_step
    } else {
        p.orogenic_initial_shortening
    };
    for cell in 0..n {
        let id = code(field, C::OrogenicComponentIds, cell)?;
        if id >= 0
            && distance.get(cell)?
                > fronts[id as usize]
                    + components[id as usize].strain * drift * p.orogenic_accretion_ratio
        {
            field
                .shared
                .code_mut(C::OrogenicComponentIds)
                .set(cell, -1)?;
        }
    }
    Ok(Frame {
        distance,
        source,
        reach,
        overlap,
    })
}
