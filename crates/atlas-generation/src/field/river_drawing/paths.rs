use super::{
    curves::{self, Station},
    Drawing, Point,
};
use crate::{
    field::{significance::measure, Field},
    lattice::sampling::Cache,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
    spatial::SpatialKernel,
    storage::Band,
    water::{
        column::Store,
        network::{RiverReader, RiverSample, RiverTerrain},
        WaterView,
    },
};
use atlas_map::{Geometry, Position};
// hpc-exempt: water body outlines and profile names, never a numeric cell dictionary.
use std::{cell::RefCell, collections::BTreeMap, io};

#[derive(Default)]
pub struct WaterShapes {
    pub ocean: Option<Geometry>,
    // hpc-exempt: one prepared cartographic outline per lake identity.
    pub lakes: BTreeMap<i32, Geometry>,
}
pub struct Paths {
    pub x: Band<f64>,
    pub y: Band<f64>,
    pub upstream: Band<i32>,
    pub incoming: Band<i32>,
    pub water: WaterShapes,
    sampler: RefCell<Cache>,
}
impl Paths {
    pub fn new(field: &Field) -> io::Result<Self> {
        let count = field.mesh.len();
        let mut coverage = field.coverage.borrow_mut();
        let mut paths = Self {
            x: coverage.allocate(0.0),
            y: coverage.allocate(0.0),
            upstream: coverage.allocate(-1),
            incoming: coverage.allocate(0),
            water: WaterShapes::default(),
            sampler: RefCell::new(Cache::new(count)),
        };
        drop(coverage);
        let owner = field.water.borrow();
        let reader = owner.river_reader();
        let water = owner.read_only();
        let terrain = RiverTerrain {
            mesh: &field.mesh,
            water_kind: &water.column.kind,
            targets: &water.routing.targets,
        };
        for cell in 0..count {
            let [x, y] = field.mesh.position(cell);
            paths.x.set(cell, x)?;
            paths.y.set(cell, y)?;
            let Some(target) = reader.successor(cell, None, &terrain)? else {
                continue;
            };
            if reader.order_at(cell, water.column.kind.get(cell)?) == 0 {
                continue;
            }
            paths
                .incoming
                .set(target, paths.incoming.get(target)? + 1)?;
            let previous = paths.upstream.get(target)?;
            if previous < 0
                || reader.water_at(cell, false, water.flow.mean.get(cell)?)
                    > reader.water_at(
                        previous as usize,
                        false,
                        water.flow.mean.get(previous as usize)?,
                    )
            {
                paths.upstream.set(target, cell as i32)?;
            }
        }
        for _ in 0..3 {
            paths.relax(field, &reader, &water, &terrain)?;
        }
        Ok(paths)
    }
    pub fn elevation_at(&self, field: &Field, point: Point) -> io::Result<f64> {
        self.sampler
            .borrow_mut()
            .sample(&field.mesh, point, |cell| {
                field.ground().view(GroundField::Elevation).get(cell)
            })
    }
    pub fn position(&self, cell: usize) -> io::Result<Point> {
        Ok([self.x.get(cell)?, self.y.get(cell)?])
    }
    fn relax(
        &mut self,
        field: &Field,
        reader: &RiverReader<'_>,
        water: &WaterView,
        terrain: &RiverTerrain<'_>,
    ) -> io::Result<()> {
        let x = self.x.snapshot()?;
        let y = self.y.snapshot()?;
        for cell in 0..field.mesh.len() {
            let previous = self.upstream.get(cell)?;
            let next = reader.successor(cell, None, terrain)?;
            if previous < 0
                || next.is_none()
                || reader.order_at(cell, water.column.kind.get(cell)?) == 0
                || water.column.kind.get(cell)? != 0
            {
                continue;
            }
            let mut shore = false;
            for edge in 0..3 {
                if let Some(next) = field.mesh.neighbor(cell, edge) {
                    shore |= water.column.kind.get(next)? != 0;
                }
            }
            if shore {
                continue;
            }
            let previous = previous as usize;
            let next = next.unwrap();
            let [cx, cy] = field.mesh.position(cell);
            let xi = x.get(cell)?;
            let dx = xi
                + (field.mesh.delta_x(x.get(previous)? - xi)
                    + field.mesh.delta_x(x.get(next)? - xi))
                    / 4.0
                - cx;
            let dy = (y.get(previous)? + y.get(next)? + 2.0 * y.get(cell)?) / 4.0 - cy;
            let factor = (field.mesh.spacing() * 0.45 / dx.hypot(dy)).min(1.0);
            self.x.set(cell, cx + dx * factor)?;
            self.y.set(cell, cy + dy * factor)?;
        }
        Ok(())
    }
    pub fn draw(
        &self,
        field: &Field,
        members: &[usize],
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Drawing> {
        if members.len() < 2 {
            return Err(io::Error::other(
                "A river drawing requires at least two members",
            ));
        }
        let owner = field.water.borrow();
        let reader = owner.river_reader();
        let water = owner.read_only();
        let trace = Trace {
            paths: self,
            field,
            reader,
            water,
        };
        let mut stations = vec![Station {
            point: self.position(members[0])?,
            segment: 0,
            fraction: 0.0,
        }];
        let tolerance = measure(&field.scale, 0.000025, 1, 1.0)?.min(field.scale.cells(1.0 / 64.0));
        for (segment, pair) in members.windows(2).enumerate() {
            let [i, j] = [pair[0], pair[1]];
            let a = self.position(i)?;
            let mut d = self.position(j)?;
            d[0] = a[0] + field.mesh.delta_x(d[0] - a[0]);
            let offset = stations.last().unwrap().point[0] - a[0];
            let start = stations.len();
            curves::append(
                [a, trace.handle(i, j, false)?, trace.handle(i, j, true)?, d],
                segment,
                tolerance,
                &mut stations,
            );
            for station in &mut stations[start..] {
                station.point[0] += offset;
            }
        }
        trace.clip_receiving(members, &mut stations, spatial)?;
        let profile = |part| -> io::Result<Vec<f64>> {
            stations
                .iter()
                .map(|s| {
                    let a = trace.sample(members[s.segment], part)?;
                    let b = trace.sample(members[s.segment + 1], part)?;
                    Ok(a * (1.0 - s.fraction) + b * s.fraction)
                })
                .collect()
        };
        // hpc-exempt: seven named longitudinal profile channels.
        let mut profiles = BTreeMap::new();
        for (key, part) in [
            ("discharges", Profile::Flow),
            ("widths", Profile::Width),
            ("depths", Profile::Depth),
            ("flowingMonths", Profile::Months),
            ("catchmentAreas", Profile::Catchment),
            ("elevations", Profile::Elevation),
            ("bedElevations", Profile::Bed),
        ] {
            profiles.insert(key.into(), profile(part)?);
        }
        let [ox, oy] = field.mesh.origin();
        Ok(Drawing {
            coordinates: stations
                .iter()
                .map(|s| Position::xy(s.point[0] + ox, s.point[1] + oy))
                .collect(),
            profiles,
        })
    }
}
#[derive(Clone, Copy)]
enum Profile {
    Flow,
    Width,
    Depth,
    Months,
    Catchment,
    Elevation,
    Bed,
}
struct Trace<'a> {
    paths: &'a Paths,
    field: &'a Field,
    reader: RiverReader<'a>,
    water: WaterView,
}
impl Trace<'_> {
    fn next(&self, cell: usize) -> io::Result<Option<usize>> {
        self.reader.successor(
            cell,
            None,
            &RiverTerrain {
                mesh: &self.field.mesh,
                water_kind: &self.water.column.kind,
                targets: &self.water.routing.targets,
            },
        )
    }
    fn open_water(&self, cell: usize) -> io::Result<Option<usize>> {
        let mut best = None;
        let depth = self.water.column.store(Store::Standing);
        for edge in 0..3 {
            let Some(next) = self.field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if self.water.column.kind.get(next)? == self.water.column.kind.get(cell)?
                && self.water.column.body.get(next)? == self.water.column.body.get(cell)?
                && depth.held(next)? > depth.held(best.unwrap_or(cell))?
            {
                best = Some(next);
            }
        }
        Ok(best)
    }
    fn tangent(&self, cell: usize) -> io::Result<Point> {
        let previous = usize::try_from(self.paths.upstream.get(cell)?).ok();
        let mut next = self.next(cell)?;
        if next.is_none() && self.water.column.kind.get(cell)? != 0 {
            next = self.open_water(cell)?;
        }
        let a = self.paths.position(previous.unwrap_or(cell))?;
        let b = self.paths.position(next.unwrap_or(cell))?;
        Ok([self.field.mesh.delta_x(b[0] - a[0]), b[1] - a[1]])
    }
    fn handle(&self, i: usize, j: usize, end: bool) -> io::Result<Point> {
        let source = self.paths.position(i)?;
        let mut target = self.paths.position(j)?;
        let direction = self.tangent(if end { j } else { i })?;
        let chord = [
            self.field.mesh.delta_x(target[0] - source[0]),
            target[1] - source[1],
        ];
        target[0] = source[0] + chord[0];
        let vector = if direction[0] * chord[0] + direction[1] * chord[1] > 0.0 {
            direction
        } else {
            chord
        };
        let scale = chord[0].hypot(chord[1]) / (3.0 * vector[0].hypot(vector[1]))
            * if end { -1.0 } else { 1.0 };
        Ok(corridor(
            self.field,
            i,
            j,
            if end { target } else { source },
            [vector[0] * scale, vector[1] * scale],
        ))
    }
    fn sample(&self, cell: usize, part: Profile) -> io::Result<f64> {
        let sampled = match part {
            Profile::Flow => {
                return Ok(self
                    .reader
                    .water_at(cell, false, self.water.flow.mean.get(cell)?))
            }
            Profile::Width => self.reader.sample(cell, RiverSample::Width, 0.0),
            Profile::Depth => self.reader.sample(cell, RiverSample::Depth, 0.0),
            Profile::Months => self.reader.sample(cell, RiverSample::Months, 0.0),
            Profile::Catchment => self.reader.sample(
                cell,
                RiverSample::Catchment,
                self.water.flow.catchment.get(cell)?,
            ),
            Profile::Elevation | Profile::Bed => {
                let bed = MapScale::metres(
                    self.reader.sample(
                        cell,
                        RiverSample::Bed,
                        self.field.ground().view(GroundField::Elevation).get(cell)?,
                    ),
                    LengthUnit::Native,
                );
                bed + if matches!(part, Profile::Elevation) {
                    self.reader.sample(cell, RiverSample::Depth, 0.0)
                } else {
                    0.0
                }
            }
        };
        Ok(sampled)
    }
    fn clip_receiving(
        &self,
        members: &[usize],
        stations: &mut Vec<Station>,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<()> {
        let mut receiving = None;
        for (at, &cell) in members.iter().enumerate() {
            if self.water.column.kind.get(cell)? != 0 {
                receiving = Some(at);
                break;
            }
        }
        let Some(receiving) = receiving.filter(|&at| at > 0) else {
            return Ok(());
        };
        let last = members[receiving];
        let shape = if self.water.column.kind.get(last)? == 1 {
            self.paths.water.ocean.as_ref()
        } else {
            self.paths
                .water
                .lakes
                .get(&self.water.column.body.get(last)?)
        };
        let level = self.water.column.surface.get(last)?;
        if let Some(shape) = shape {
            spatial
                .with_point_coverage(shape, &mut |covers| {
                    let [ox, oy] = self.field.mesh.origin();
                    trim_receiving(stations, receiving, |point| {
                        let x = self.field.mesh.point(point[0], point[1])[0];
                        covers(Position::xy(x + ox, point[1] + oy)).map_err(io::Error::other)
                    })
                    .map_err(|e| e.to_string())
                })
                .map_err(io::Error::other)
        } else {
            trim_receiving(stations, receiving, |point| {
                Ok(level.is_finite() && self.paths.elevation_at(self.field, point)? < level)
            })
        }
    }
}
fn trim_receiving(
    stations: &mut Vec<Station>,
    receiving: usize,
    wet: impl Fn(Point) -> io::Result<bool>,
) -> io::Result<()> {
    for n in 0..stations.len() - 1 {
        let (a, b) = (&stations[n], &stations[n + 1]);
        if b.segment < receiving - 1 || !wet(b.point)? {
            continue;
        }
        let (mut low, mut high) = (0.0, 1.0);
        while (high - low) * (b.point[0] - a.point[0]).hypot(b.point[1] - a.point[1]) > 1e-6 {
            let middle = (low + high) / 2.0;
            if wet(curves::mix(a.point, b.point, middle))? {
                high = middle;
            } else {
                low = middle;
            }
        }
        let fraction = (low + high) / 2.0;
        let start = if a.segment == b.segment {
            a.fraction
        } else {
            0.0
        };
        let end = Station {
            point: curves::mix(a.point, b.point, fraction),
            segment: b.segment,
            fraction: start + (b.fraction - start) * fraction,
        };
        stations.truncate(n + 1);
        stations.push(end);
        break;
    }
    Ok(())
}
fn corridor(field: &Field, i: usize, j: usize, a: Point, d: Point) -> Point {
    let pi = field.mesh.position(i);
    let pj = field.mesh.position(j);
    let dx = field.mesh.delta_x(pj[0] - pi[0]);
    let dy = pj[1] - pi[1];
    let h = dx.hypot(dy);
    let (ex, ey) = (dx / h, dy / h);
    let (x, y) = (a[0] - (pi[0] + dx / 2.0), a[1] - (pi[1] + pj[1]) / 2.0);
    let (u, v) = (
        (x * ex + y * ey) / (1.5 * h),
        (-x * ey + y * ex) / (3.0f64.sqrt() * h / 2.0),
    );
    let (du, dv) = (
        (d[0] * ex + d[1] * ey) / (1.5 * h),
        (-d[0] * ey + d[1] * ex) / (3.0f64.sqrt() * h / 2.0),
    );
    let mut fraction = 1.0f64;
    for sx in [-1.0, 1.0] {
        for sy in [-1.0, 1.0] {
            let rate = sx * du + sy * dv;
            if rate > 0.0 {
                fraction = fraction.min(((1.0 - sx * u - sy * v) / rate).max(0.0));
            }
        }
    }
    [a[0] + d[0] * fraction, a[1] + d[1] * fraction]
}
