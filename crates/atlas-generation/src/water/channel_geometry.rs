//! Hydraulic profiles belong to reaches; widening projects their banks onto nearby ground.
use super::{
    balance::{flow_through_year, MONTHS},
    network::RiverProjection,
    reaches::{Reach, ReachStore},
};
use crate::{
    hpc::RecordQueue,
    lattice::TriangularLattice,
    rock::catalogue::RockFamily,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::{Band, Coverage, ReadBand},
};
use std::io;

pub struct ChannelGeometry {
    width: Band<f64>,
    depth: Band<f64>,
    strength: Band<f64>,
    orders: Band<u32>,
}
pub struct ChannelView {
    pub width: ReadBand<f64>,
    pub depth: ReadBand<f64>,
    pub strength: ReadBand<f64>,
    pub orders: ReadBand<u32>,
}
impl ChannelGeometry {
    pub(super) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> io::Result<()> {
        archive.band("channel-width", &mut self.width)?;
        archive.band("channel-depth", &mut self.depth)?;
        archive.band("channel-strength", &mut self.strength)?;
        archive.band("channel-orders", &mut self.orders)
    }
    pub(super) fn inherit_dimensions(
        &mut self,
        cell: usize,
        values: [Option<f64>; 3],
    ) -> io::Result<()> {
        for (band, value) in [&mut self.width, &mut self.depth, &mut self.strength]
            .into_iter()
            .zip(values)
        {
            if let Some(value) = value {
                band.set(cell, value)?;
            }
        }
        Ok(())
    }
}
pub struct ChannelSettings {
    pub maximum_bank_relief: f64,
    pub maximum_longitudinal_alignment: f64,
    pub plain_slope_threshold: f64,
    pub width_decay: f64,
    pub widening_order: f64,
    pub widening_discharge_multiplier: f64,
    pub accumulation_threshold: f64,
    pub base_strength: f64,
    pub order_strength: f64,
    pub discharge_strength: f64,
}
pub struct ChannelInputs<'a> {
    pub mesh: &'a TriangularLattice,
    pub scale: &'a MapScale,
    pub settings: &'a ChannelSettings,
    pub targets: &'a ReadBand<i32>,
    pub orders: &'a ReadBand<u32>,
    pub kind: &'a ReadBand<u8>,
    pub basins: &'a ReadBand<i32>,
    pub elevation: &'a ReadBand<f64>,
    pub slope: &'a ReadBand<f64>,
    pub flow: &'a ReadBand<f64>,
    pub standing: &'a dyn Fn(usize) -> io::Result<f64>,
    /// The family of the bed a channel runs on at a cell.
    pub bed: &'a dyn Fn(usize) -> io::Result<RockFamily>,
}
pub struct Dimensions {
    pub width: f64,
    pub depth: f64,
}
fn measure(scale: &MapScale, relative: f64, dimension: i8) -> io::Result<f64> {
    Ok(scale
        .resolve(
            RelativeMeasure::new(relative, dimension, 1.0, LengthUnit::Metre)
                .map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?
        .value())
}
/// A channel's width and depth. On a real-scale map a channel is its real size, from its
/// discharge and its bed's rock family (`processes::ground::channels`); elsewhere it is a
/// share of the map from discharge, gradient and bank strength.
pub fn channel_dimensions(
    discharge: f64,
    slope: f64,
    bank: f64,
    bed: RockFamily,
    scale: &MapScale,
) -> io::Result<Dimensions> {
    if scale.real_size() {
        let made = crate::processes::ground::channels::channel(discharge, bed);
        return Ok(Dimensions {
            width: made.width,
            depth: made.depth,
        });
    }
    let q = discharge.max(0.0) / measure(scale, 1.5625e-20, 3)?;
    let gradient = slope.max(0.00001);
    Ok(Dimensions {
        width: measure(scale, 1.125e-6, 1)?
            * q.sqrt()
            * (0.001 / gradient).powf(0.08).clamp(0.6, 1.6)
            / bank.powf(0.15),
        depth: measure(scale, 8.75e-8, 1)? * q.powf(0.3) * bank.powf(0.1),
    })
}
fn normalize(x: f64, y: f64) -> [f64; 2] {
    let length = x.hypot(y).max(0.000001);
    [x / length, y / length]
}
fn direction(mesh: &TriangularLattice, source: usize, target: usize) -> [f64; 2] {
    let [x, y] = mesh.position(source);
    let [tx, ty] = mesh.position(target);
    normalize(mesh.delta_x(tx - x) as f32 as f64, (ty - y) as f32 as f64)
}
pub fn dominant_upstream(
    input: &ChannelInputs<'_>,
    channel: impl Fn(usize) -> io::Result<bool>,
    coverage: &mut Coverage,
) -> io::Result<Band<i32>> {
    let mut upstream = coverage.scratch(input.mesh.len(), -1);
    for cell in 0..input.mesh.len() {
        let Ok(target) = usize::try_from(input.targets.get(cell)?) else {
            continue;
        };
        if !channel(cell)? || !channel(target)? {
            continue;
        }
        let previous = upstream.get(target)?;
        if previous < 0 || input.flow.get(cell)? > input.flow.get(previous as usize)? {
            upstream.set(target, cell as i32)?;
        }
    }
    Ok(upstream)
}
pub fn longitudinal_alignment(
    input: &ChannelInputs<'_>,
    upstream: &ReadBand<i32>,
    spine: usize,
    target: usize,
) -> io::Result<f64> {
    let (mut x, mut y) = (0.0, 0.0);
    if let Ok(next) = usize::try_from(input.targets.get(spine)?) {
        let [dx, dy] = direction(input.mesh, spine, next);
        x += dx;
        y += dy;
    }
    if let Ok(previous) = usize::try_from(upstream.get(spine)?) {
        let [dx, dy] = direction(input.mesh, previous, spine);
        x += dx;
        y += dy;
    }
    let [tx, ty] = normalize(x, y);
    let [bx, by] = direction(input.mesh, spine, target);
    Ok((tx * bx + ty * by).abs())
}
impl ChannelGeometry {
    pub fn clear(&mut self) -> io::Result<()> {
        for cell in 0..self.width.len() {
            self.width.set(cell, 0.0)?;
            self.depth.set(cell, 0.0)?;
            self.strength.set(cell, 0.0)?;
            self.orders.set(cell, 0)?;
        }
        Ok(())
    }
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            width: coverage.allocate(0.0),
            depth: coverage.allocate(0.0),
            strength: coverage.allocate(0.0),
            orders: coverage.allocate(0),
        }
    }
    pub fn read_only(&self) -> ChannelView {
        ChannelView {
            width: self.width.read_only(),
            depth: self.depth.read_only(),
            strength: self.strength.read_only(),
            orders: self.orders.read_only(),
        }
    }
    pub fn project(
        &mut self,
        input: ChannelInputs<'_>,
        rivers: &mut ReachStore,
        projection: &mut RiverProjection,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        for cell in 0..input.mesh.len() {
            self.width.set(cell, 0.0)?;
            self.depth.set(cell, 0.0)?;
            self.strength.set(cell, 0.0)?;
            self.orders.set(cell, 0)?;
        }
        let upstream = dominant_upstream(&input, |cell| Ok(input.orders.get(cell)? > 0), coverage)?;
        let mut frontier = RecordQueue::<3>::default();
        for reach in rivers
            .records_mut()
            .iter_mut()
            .flatten()
            .filter(|reach| !reach.dry)
        {
            for at in 0..reach.cells.len() {
                self.size(&input, reach, at, &mut frontier)?;
            }
        }
        self.expand(&input, &upstream.read_only(), &mut frontier)?;
        self.extend_spines(&input, projection, coverage)
    }
    fn size(
        &mut self,
        input: &ChannelInputs<'_>,
        reach: &mut Reach,
        at: usize,
        frontier: &mut RecordQueue<3>,
    ) -> io::Result<()> {
        let cell = reach.cells[at];
        let start = (at * MONTHS).min(reach.monthly.len());
        let end = ((at + 1) * MONTHS).min(reach.monthly.len());
        let flow = flow_through_year(&reach.monthly[start..end], 0.0).mean;
        if flow <= 0.0 || input.kind.get(cell)? != 0 {
            return Ok(());
        }
        let dimensions = channel_dimensions(
            flow,
            input.slope.get(cell)?,
            (input.standing)(cell)?,
            (input.bed)(cell)?,
            input.scale,
        )?;
        reach.width[at] = dimensions.width;
        reach.depth[at] = dimensions.depth;
        self.width.set(cell, dimensions.width)?;
        self.depth.set(cell, dimensions.depth)?;
        let discharge = (flow
            / measure(input.scale, 1.5625e-20, 3)?.max(input.settings.accumulation_threshold))
        .trunc();
        self.strength.set(
            cell,
            (input.settings.base_strength
                + (f64::from(reach.order) - 1.0) * input.settings.order_strength
                + discharge * input.settings.discharge_strength)
                .clamp(1.0, 1000.0),
        )?;
        self.orders.set(cell, u32::from(reach.order))?;
        let maximum = self.expansion(input, cell)?;
        if maximum > 0.0 {
            frontier.push(cell as u32, [cell as f64, 0.0, maximum]);
        }
        Ok(())
    }
    fn expansion(&self, input: &ChannelInputs<'_>, cell: usize) -> io::Result<f64> {
        let order = f64::from(input.orders.get(cell)?);
        let discharge = (input.flow.get(cell)?
            / measure(input.scale, 1.5625e-20, 3)?.max(input.settings.accumulation_threshold))
        .trunc();
        if order < input.settings.widening_order
            && discharge < input.settings.widening_discharge_multiplier
        {
            return Ok(0.0);
        }
        let scale = (order - input.settings.widening_order)
            .max((discharge / input.settings.widening_discharge_multiplier).trunc());
        Ok(self.width.get(cell)? / 2.0 * (1.0 + scale * 0.05))
    }
    fn can_widen(
        &self,
        input: &ChannelInputs<'_>,
        upstream: &ReadBand<i32>,
        spine: usize,
        target: usize,
    ) -> io::Result<bool> {
        if input.orders.get(target)? > 0
            || input.kind.get(target)? != 0
            || input.basins.get(target)? != input.basins.get(spine)?
            || (input.elevation.get(spine)? - input.elevation.get(target)?).abs()
                > MapScale::native(input.settings.maximum_bank_relief)
        {
            return Ok(false);
        }
        Ok(longitudinal_alignment(input, upstream, spine, target)?
            <= input.settings.maximum_longitudinal_alignment / 1000.0)
    }
    fn widen(
        &mut self,
        input: &ChannelInputs<'_>,
        upstream: &ReadBand<i32>,
        front: (usize, [f64; 3]),
        target: usize,
    ) -> io::Result<bool> {
        let (triangle, [spine, depth, maximum]) = front;
        let spine = spine as usize;
        let depth = depth + input.mesh.physical_distance(triangle, target);
        if depth > maximum || !self.can_widen(input, upstream, spine, target)? {
            return Ok(false);
        }
        let relief = MapScale::metres(
            (input.elevation.get(spine)? - input.elevation.get(target)?).abs(),
            LengthUnit::Native,
        )
        .round();
        let slope =
            (input.slope.get(target)? - input.settings.plain_slope_threshold).max(0.0) * 10_000.0;
        let strength = (self.strength.get(spine)?
            - input.settings.width_decay * depth / measure(input.scale, 0.0025, 1)?
            - relief / measure(input.scale, 2.5e-7, 1)?
            - slope)
            .max(1.0);
        let order = self.orders.get(spine)?;
        let held = self.strength.get(target)?;
        if strength < held || (strength == held && order <= self.orders.get(target)?) {
            return Ok(false);
        }
        self.strength.set(target, strength)?;
        self.orders.set(target, order)?;
        Ok(depth < maximum)
    }
    fn expand(
        &mut self,
        input: &ChannelInputs<'_>,
        upstream: &ReadBand<i32>,
        frontier: &mut RecordQueue<3>,
    ) -> io::Result<()> {
        while let Some((triangle, fields)) = frontier.pop() {
            let triangle = triangle as usize;
            for edge in 0..3 {
                let Some(target) = input.mesh.neighbor(triangle, edge) else {
                    continue;
                };
                if self.widen(input, upstream, (triangle, fields), target)? {
                    frontier.push(
                        target as u32,
                        [
                            fields[0],
                            fields[1] + input.mesh.physical_distance(triangle, target),
                            fields[2],
                        ],
                    );
                }
            }
        }
        Ok(())
    }
    fn extend_spines(
        &self,
        input: &ChannelInputs<'_>,
        projection: &mut RiverProjection,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let inflow = dominant_upstream(input, |cell| Ok(self.strength.get(cell)? > 0.0), coverage)?;
        for head in 0..input.mesh.len() {
            if input.orders.get(head)? == 0 {
                continue;
            }
            let mut target = head;
            while let Ok(source) = usize::try_from(inflow.get(target)?) {
                if input.orders.get(source)? > 0 {
                    break;
                }
                let se = (0..3).find(|&edge| input.mesh.neighbor(source, edge) == Some(target));
                let te = (0..3).find(|&edge| input.mesh.neighbor(target, edge) == Some(source));
                let (Some(se), Some(te)) = (se, te) else {
                    break;
                };
                projection
                    .spines
                    .set(source, projection.spines.get(source)? | (1 << se))?;
                projection
                    .spines
                    .set(target, projection.spines.get(target)? | (1 << te))?;
                target = source;
            }
        }
        Ok(())
    }
    pub fn shoal_bed(
        &mut self,
        rivers: &mut ReachStore,
        cell: usize,
        depth: f64,
    ) -> io::Result<()> {
        let index = rivers.cell_index();
        let Some(reach) = index.get(rivers, cell) else {
            return Ok(());
        };
        let id = reach.id;
        let at = index.position(cell).expect("indexed reach has a position");
        let reach = rivers.get_mut(id).expect("indexed reach exists");
        if depth < reach.depth[at] {
            reach.depth[at] = depth.max(0.0);
            self.depth.set(cell, reach.depth[at])?;
        }
        Ok(())
    }
}
