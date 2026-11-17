use super::state::State;
use crate::{
    field::{
        shared::{CellCode, Scalar},
        significance::measure,
        Field,
    },
    magic::propagation::ocean::coast_distances_on,
    storage::Band,
};
use atlas_map::Bounds;
use std::{cell::RefCell, io};

const SAMPLES: usize = 24;
const RADII: [f64; 10] = [
    0.000375, 0.00075, 0.0015, 0.003, 0.00625, 0.0125, 0.025, 0.05, 0.1, 0.2,
];
const PATH_SLACK: f64 = 1.25;
const SIGHT_SAMPLES: f64 = 16.0;
const WRAPPING_ARC: usize = 14;
const OPPOSED_SHORES: f64 = 8.0;
const LEAST_SHORE: usize = 2;
const NECK_RADII: f64 = 5.0;
#[derive(Clone, Copy, Default, PartialEq, Eq)]
#[repr(u8)]
pub enum Form {
    #[default]
    None,
    Headland,
    Bay,
    Strait,
}
#[derive(Clone, Copy, Default)]
pub struct Reading {
    pub form: Form,
    pub wrap: f64,
}
#[derive(Clone, Copy)]
struct Arc {
    sea: bool,
    start: usize,
    length: usize,
}
impl Arc {
    fn middle(self) -> f64 {
        self.start as f64 + self.length as f64 / 2.0
    }
}
fn sea(field: &Field, cell: usize) -> io::Result<bool> {
    Ok(field.water.borrow().kind_at(cell)? == 1)
}
fn circle(field: &Field, cell: usize, radius: f64) -> io::Result<Option<[bool; SAMPLES]>> {
    let mesh = &field.mesh;
    let Bounds(west, south, east, north) = mesh.bounds();
    let [x, y] = mesh.position(cell);
    let mut ring = [false; SAMPLES];
    for (k, value) in ring.iter_mut().enumerate() {
        let angle = k as f64 * std::f64::consts::TAU / SAMPLES as f64;
        let (x, y) = (x + radius * angle.cos(), y + radius * angle.sin());
        if y < south || y > north || (mesh.periodic_width().is_none() && (x < west || x > east)) {
            return Ok(None);
        }
        let Some(at) = mesh.cell_at(x, y) else {
            return Ok(None);
        };
        *value = sea(field, at)?;
    }
    Ok(Some(ring))
}
fn arcs(ring: &[bool; SAMPLES]) -> Vec<Arc> {
    let Some(first) = (0..SAMPLES).find(|&k| ring[k] != ring[(k + SAMPLES - 1) % SAMPLES]) else {
        return Vec::new();
    };
    let mut arcs: Vec<Arc> = Vec::new();
    for k in 0..SAMPLES {
        let at = (first + k) % SAMPLES;
        if let Some(last) = arcs.last_mut().filter(|a| a.sea == ring[at]) {
            last.length += 1;
        } else {
            arcs.push(Arc {
                sea: ring[at],
                start: at,
                length: 1,
            });
        }
    }
    arcs
}
fn longest(arcs: &[Arc], sea: bool) -> usize {
    arcs.iter()
        .filter(|arc| arc.sea == sea)
        .map(|arc| arc.length)
        .max()
        .unwrap_or(0)
}
fn ground(arcs: &[Arc]) -> usize {
    arcs.iter()
        .filter(|arc| !arc.sea)
        .map(|arc| arc.length)
        .sum()
}
fn runs_along(
    field: &Field,
    cell: usize,
    sample: f64,
    reach: f64,
    is_sea: bool,
) -> io::Result<bool> {
    let angle = sample * std::f64::consts::TAU / SAMPLES as f64;
    let step = field.scale.supported(reach / SIGHT_SAMPLES, 1.0);
    let [x, y] = field.mesh.position(cell);
    let mut distance = step;
    while distance < reach {
        let Some(next) = field
            .mesh
            .cell_at(x + distance * angle.cos(), y + distance * angle.sin())
        else {
            return Ok(false);
        };
        if sea(field, next)? != is_sea {
            return Ok(false);
        }
        distance += step;
    }
    Ok(true)
}
fn largest_shores(arcs: &[Arc]) -> Option<[Arc; 2]> {
    let mut best: [Option<Arc>; 2] = [None, None];
    for &arc in arcs.iter().filter(|a| !a.sea && a.length >= LEAST_SHORE) {
        if best[0].is_none_or(|b| arc.length > b.length) {
            best[1] = best[0];
            best[0] = Some(arc);
        } else if best[1].is_none_or(|b| arc.length > b.length) {
            best[1] = Some(arc);
        }
    }
    Some([best[0]?, best[1]?])
}
fn facing(field: &Field, cell: usize, arcs: &[Arc], radius: f64) -> io::Result<bool> {
    let Some(shores) = largest_shores(arcs) else {
        return Ok(false);
    };
    if ground(arcs) * 2 < SAMPLES {
        return Ok(false);
    }
    let apart = (shores[0].middle() - shores[1].middle()).abs() % SAMPLES as f64;
    if apart.min(SAMPLES as f64 - apart) < OPPOSED_SHORES {
        return Ok(false);
    }
    let mut gaps = 0;
    for arc in arcs.iter().filter(|a| a.sea) {
        if runs_along(field, cell, arc.middle(), radius, true)? {
            gaps += 1;
        }
    }
    Ok(gaps >= 2)
}
fn sea_form(field: &Field, cell: usize, arcs: &[Arc], radius: f64) -> io::Result<Reading> {
    if facing(field, cell, arcs, radius)? {
        return Ok(Reading {
            form: Form::Strait,
            wrap: ground(arcs) as f64 / SAMPLES as f64,
        });
    }
    let shore = longest(arcs, false);
    Ok(if shore >= WRAPPING_ARC {
        Reading {
            form: Form::Bay,
            wrap: shore as f64 / SAMPLES as f64,
        }
    } else {
        Reading::default()
    })
}
fn land_form(field: &Field, cell: usize, arcs: &[Arc], radius: f64) -> io::Result<Reading> {
    let open = longest(arcs, true);
    if open < WRAPPING_ARC {
        return Ok(Reading::default());
    }
    let mut neck: Option<Arc> = None;
    for &arc in arcs.iter().filter(|a| !a.sea) {
        if neck.is_none_or(|n| arc.length > n.length) {
            neck = Some(arc);
        }
    }
    let Some(neck) = neck else {
        return Ok(Reading::default());
    };
    Ok(
        if runs_along(field, cell, neck.middle(), NECK_RADII * radius, false)? {
            Reading {
                form: Form::Headland,
                wrap: open as f64 / SAMPLES as f64,
            }
        } else {
            Reading::default()
        },
    )
}
fn on_circle(field: &Field, cell: usize, radius: f64) -> io::Result<Reading> {
    let Some(ring) = circle(field, cell, radius)? else {
        return Ok(Reading::default());
    };
    let arcs = arcs(&ring);
    if arcs.is_empty() {
        return Ok(Reading::default());
    }
    if sea(field, cell)? {
        sea_form(field, cell, &arcs, radius)
    } else {
        land_form(field, cell, &arcs, radius)
    }
}
fn sea_distance(state: &impl State, cell: usize) -> io::Result<f64> {
    let distances = state.held().get("shoreForm:seaDistance", || {
        let field = state.field()?;
        let water = field.water();
        let reach = measure(&field.scale, RADII[RADII.len() - 1], 1, 1.0)? * PATH_SLACK;
        let distance =
            coast_distances_on(&field.mesh, &water, reach, &mut field.coverage.borrow_mut())?;
        let mut kept = field.coverage.borrow_mut().allocate(0f32);
        for cell in 0..field.mesh.len() {
            kept.set(cell, distance.get(cell)? as f32)?;
        }
        Ok(kept)
    })?;
    Ok(f64::from(distances.get(cell)?))
}
fn read(state: &impl State, cell: usize) -> io::Result<Reading> {
    let field = state.field()?;
    let is_sea = sea(field, cell)?;
    let ocean_distance = field.shared.scalar(Scalar::OceanDistance).get(cell)?;
    if (is_sea && field.shared.code(CellCode::LandformCodes).get(cell)? == 11)
        || (!is_sea && ocean_distance < 0.0)
    {
        return Ok(Reading::default());
    }
    let distance = if is_sea {
        sea_distance(state, cell)?
    } else {
        ocean_distance
    };
    for fraction in RADII {
        let radius = measure(&field.scale, fraction, 1, 1.0)?;
        if radius < field.scale.cells(2.0) || radius * PATH_SLACK < distance {
            continue;
        }
        let reading = on_circle(field, cell, radius)?;
        if reading.form != Form::None {
            return Ok(reading);
        }
    }
    Ok(Reading::default())
}
struct Readings {
    read: Band<u8>,
    code: Band<u8>,
    wrap: Band<f32>,
}
pub fn at(state: &impl State, cell: usize) -> io::Result<Reading> {
    let table = state.held().get("shoreForm", || {
        let mut coverage = state.field()?.coverage.borrow_mut();
        Ok(RefCell::new(Readings {
            read: coverage.allocate(0),
            code: coverage.allocate(0),
            wrap: coverage.allocate(0.0),
        }))
    })?;
    let mut table = table.borrow_mut();
    if table.read.get(cell)? == 0 {
        let reading = read(state, cell)?;
        table.read.set(cell, 1)?;
        table.code.set(cell, reading.form as u8)?;
        table.wrap.set(cell, reading.wrap as f32)?;
    }
    Ok(Reading {
        form: match table.code.get(cell)? {
            1 => Form::Headland,
            2 => Form::Bay,
            3 => Form::Strait,
            _ => Form::None,
        },
        wrap: f64::from(table.wrap.get(cell)?),
    })
}
