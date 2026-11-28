mod fronts;
mod gyres;
pub mod settings;
use super::{ocean, read, wrap, write};
use crate::{
    chance::Chance,
    execution::{ExecutionError, Query, QueryDependency},
    field::{shared::Scalar as S, Field},
    hpc::EpochStamps,
    metric::smoothing::Smoother,
    processes::runner::PhysicalContext,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::{Band, ReadBand},
    water::column::Store,
};
use settings::Settings;
use std::{io, rc::Rc};

fn smooth_directions(field: &Field, p: &Settings) -> io::Result<()> {
    let mut coverage = field.coverage.borrow_mut();
    let mut active = coverage.allocate(0u8);
    for cell in 0..field.mesh.len() {
        active.set(cell, u8::from(ocean(field, cell)?))?;
    }
    let mut smoother = Smoother::new(
        &field.mesh,
        &mut coverage,
        p.ocean_current_smoothing_length,
        Some(&active.read_only()),
    )?;
    let x = smoother.apply(&field.shared.scalar(S::OceanCurrentX), &mut coverage)?;
    let y = smoother.apply(&field.shared.scalar(S::OceanCurrentY), &mut coverage)?;
    for cell in 0..field.mesh.len() {
        if !ocean(field, cell)? {
            continue;
        }
        let (x, y) = (x.get(cell)?, y.get(cell)?);
        let length = x.hypot(y);
        let vector = if length < 1e-6 {
            [0.0; 2]
        } else {
            [(x / length * 1000.0).round(), (y / length * 1000.0).round()]
        };
        write(field, S::OceanCurrentX, cell, vector[0])?;
        write(field, S::OceanCurrentY, cell, vector[1])?;
    }
    Ok(())
}
fn upstream(field: &Field) -> io::Result<Band<i32>> {
    let mut targets = field.coverage.borrow_mut().allocate(-1i32);
    for cell in 0..field.mesh.len() {
        if !ocean(field, cell)? {
            continue;
        }
        let mut best = 0.0;
        let x = read(field, S::OceanCurrentX, cell)?;
        let y = read(field, S::OceanCurrentY, cell)?;
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if !ocean(field, next)? {
                continue;
            }
            let [dx, dy] = field.mesh.edge_direction(cell, edge);
            let score = (dx * -x) as f32 + (dy * -y) as f32;
            if score > best {
                best = score;
                targets.set(cell, next as i32)?;
            }
        }
    }
    Ok(targets)
}
fn strength(field: &Field, p: &Settings, c: &PhysicalContext) -> io::Result<()> {
    let depth = field.water().column.store(Store::Standing).contents();
    let length = field
        .scale
        .resolve(RelativeMeasure::length(0.05).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    for cell in 0..field.mesh.len() {
        if !ocean(field, cell)? {
            continue;
        }
        let depth = (MapScale::metres(depth.get(cell)?, LengthUnit::Native).round() * 420.0
            / p.shelf_break_depth)
            .trunc()
            .clamp(0.0, 420.0);
        let [x, y] = field.mesh.position(cell);
        let broad = ((Chance::of(c.seed, 0x19af)
            .noise(length, 2)
            .on(&field.mesh, [x, y])
            + 1.0)
            * 0.5
            * 250.0)
            .round();
        write(
            field,
            S::OceanCurrentStrength,
            cell,
            (p.ocean_current_minimum_strength + depth + broad).clamp(1.0, 1000.0),
        )?;
    }
    Ok(())
}
fn heat_sources(field: &Field) -> io::Result<Band<f64>> {
    let mut source = field.coverage.borrow_mut().allocate(0.0);
    for cell in 0..field.mesh.len() {
        if !ocean(field, cell)? {
            continue;
        }
        let mut heat = read(field, S::Geothermal, cell)?;
        for edge in 0..3 {
            if let Some(next) = field.mesh.neighbor(cell, edge) {
                heat = heat.max((read(field, S::Geothermal, next)? * 4.0 / 5.0).trunc());
            }
        }
        let value = (60.0 + (heat * 4.0 / 5.0).trunc()).clamp(0.0, 1000.0);
        source.set(cell, value)?;
        write(field, S::OceanCurrentHeat, cell, value)?;
    }
    Ok(source)
}
struct Trace<'a> {
    field: &'a Field,
    p: &'a Settings,
    targets: &'a ReadBand<i32>,
    edges: Option<[f64; 2]>,
    visited: EpochStamps<()>,
}
impl Trace<'_> {
    fn heat(&mut self, source: &Band<f64>, start: usize) -> io::Result<f64> {
        let mut current = start;
        let mut traveled = 0.0;
        let mut heat = source.get(start)?;
        let reach = self.p.ocean_current_heat_distance;
        self.visited.begin();
        self.visited.mark(start);
        while traveled < reach {
            let next = self.targets.get(current)?;
            if next < 0 || self.visited.marked(next as usize) {
                break;
            }
            let next = next as usize;
            let segment = wrap::distance(self.field, self.edges, current, next);
            let distance = segment.min(reach - traveled);
            let here = source.get(current)?;
            let mixed = here + (source.get(next)? - here) * distance / segment;
            traveled += distance;
            heat = heat.max(mixed - self.p.ocean_current_heat_cooling * traveled / reach);
            current = next;
            self.visited.mark(next);
        }
        Ok(heat)
    }
    fn waves(&mut self, start: usize) -> io::Result<f64> {
        let reach = self.p.ocean_current_fetch_distance;
        let mut fetch = 0.0;
        let mut current = start;
        let mut previous = -1;
        self.visited.begin();
        self.visited.mark(start);
        while fetch < reach {
            let next = self.targets.get(current)?;
            if next < 0 || next == previous || self.visited.marked(next as usize) {
                break;
            }
            self.visited.mark(next as usize);
            fetch += wrap::distance(self.field, self.edges, current, next as usize);
            previous = current as i32;
            current = next as usize;
        }
        Ok(((fetch * 760.0 / reach).trunc()
            + (read(self.field, S::OceanCurrentStrength, start)? * 240.0 / 1000.0).trunc())
        .clamp(0.0, 1000.0))
    }
}
impl Field {
    pub fn ocean_currents(
        settings: Rc<Settings>,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        Query::new(
            "ocean-currents",
            dependencies,
            move |field: &Field, scope| {
                let context = scope.input::<PhysicalContext>()?;
                field
                    .update_currents(&settings, &context)
                    .map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
    fn update_currents(&self, p: &Settings, c: &PhysicalContext) -> io::Result<()> {
        for name in [
            S::OceanCurrentX,
            S::OceanCurrentY,
            S::OceanCurrentStrength,
            S::OceanCurrentHeat,
            S::WaveExposure,
        ] {
            for cell in 0..self.mesh.len() {
                write(self, name, cell, 0.0)?;
            }
        }
        let western = gyres::directions(self, p)?;
        smooth_directions(self, p)?;
        strength(self, p, c)?;
        gyres::intensify(self, p, &western)?;
        let mut upstream = upstream(self)?;
        wrap::links(self, &p.atmosphere, &mut upstream, |cell| ocean(self, cell))?;
        let targets = upstream.read_only();
        fronts::anomaly(self, p, c, &targets)?;
        self.external_ocean_forcing()?;
        let source = heat_sources(self)?;
        let mut trace = Trace {
            field: self,
            p,
            targets: &targets,
            edges: wrap::edges(self, &p.atmosphere),
            visited: EpochStamps::new(self.mesh.len()),
        };
        for cell in 0..self.mesh.len() {
            if !ocean(self, cell)? {
                continue;
            }
            if p.ocean_current_heat_distance > 0.0 {
                write(
                    self,
                    S::OceanCurrentHeat,
                    cell,
                    trace.heat(&source, cell)?.round(),
                )?;
            }
            write(self, S::WaveExposure, cell, trace.waves(cell)?)?;
        }
        Ok(())
    }
    fn external_ocean_forcing(&self) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            if !ocean(self, cell)? {
                continue;
            }
            write(
                self,
                S::Upwelling,
                cell,
                (read(self, S::Upwelling, cell)? + read(self, S::ExternalUpwelling, cell)?)
                    .round()
                    .clamp(0.0, 1000.0),
            )?;
            write(
                self,
                S::SeaSurfaceAnomaly,
                cell,
                (read(self, S::SeaSurfaceAnomaly, cell)?
                    + read(self, S::ExternalSeaSurfaceForcing, cell)?)
                .round(),
            )?;
        }
        Ok(())
    }
}
