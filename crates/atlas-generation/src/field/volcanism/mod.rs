mod lava;
pub mod settings;
use super::{
    events::{Event, EventKind},
    shared::{CellCode as C, Scalar as S},
    Field,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError},
    processes::runner::PhysicalContext,
    rock::{catalogue, ground::GroundField},
    scale::{LengthUnit, MapScale, RelativeMeasure},
    tectonics::controls,
};
use lava::Lava;
use settings::Settings;
use std::io;

pub const CALDERA_SHARE: f64 = 0.28;
fn melt_volume(p: &Settings, context: &PhysicalContext, strength: f64) -> f64 {
    std::f64::consts::PI / 6.0 * p.volcanic_cone_radius.powi(2) * p.volcanic_cone_height * strength
        / 1000.0
        * context.span
}
fn overriding(field: &Field, cell: usize) -> io::Result<Option<[f64; 2]>> {
    let Some(state) = &field.tectonics else {
        return Ok(None);
    };
    let pair = field.shared.code(C::TectonicBoundaryPairIds).get(cell)? as u32;
    let site = |id: u32| id.checked_sub(1).and_then(|i| state.sites.get(i as usize));
    let (Some(a), Some(b)) = (site(pair >> 16), site(pair & 0xffff)) else {
        return Ok(None);
    };
    if a.plate == b.plate {
        return Ok(None);
    }
    let (Some(ai), Some(bi)) = (
        field
            .mesh
            .cell_at(a.province.position[0], a.province.position[1]),
        field
            .mesh
            .cell_at(b.province.position[0], b.province.position[1]),
    ) else {
        return Ok(None);
    };
    let score = |i| -> io::Result<f64> {
        Ok(field
            .ground()
            .view(GroundField::CrustContinentalFraction)
            .get(i)?
            * 2.0
            - field.shared.scalar(S::CrustAge).get(i)?)
    };
    let sign = if score(ai)? >= score(bi)? { -1.0 } else { 1.0 };
    let dx = field
        .mesh
        .delta_x(b.province.position[0] - a.province.position[0]);
    let dy = b.province.position[1] - a.province.position[1];
    let length = dx.hypot(dy).max(1.0);
    Ok(Some([sign * dx / length, sign * dy / length]))
}
fn arcs(
    field: &mut Field,
    p: &Settings,
    context: &PhysicalContext,
    lava: &mut Lava,
) -> io::Result<()> {
    let mut supply = field.coverage.get_mut().scratch(field.mesh.len(), 0.0);
    let offset = controls::arc_offset(field.scale).map_err(io::Error::other)?;
    for cell in 0..field.mesh.len() {
        let consumed = field.shared.scalar(S::OceanicSubduction).get(cell)?;
        let normal = overriding(field, cell)?;
        if consumed <= 0.0 {
            continue;
        }
        let Some(normal) = normal else {
            continue;
        };
        let at = field.mesh.position(cell);
        let point = field
            .mesh
            .point(at[0] + normal[0] * offset, at[1] + normal[1] * offset);
        if let Some(source) = field.mesh.cell_at(point[0], point[1]) {
            supply.set(
                source,
                supply.get(source)?
                    + MapScale::metres(consumed, LengthUnit::Native)
                        * field.mesh.area(cell)
                        * controls::ARC_MELT_SHARE,
            )?;
        }
    }
    let shell = MapScale::native(
        field
            .scale
            .resolve(RelativeMeasure::length(0.00075).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value(),
    );
    for source in 0..field.mesh.len() {
        let volume = supply.get(source)?;
        if volume <= 0.0 {
            continue;
        }
        let eruption = lava.erupt(field, p, context, source, volume)?;
        if eruption.volume <= 0.0 {
            continue;
        }
        field
            .ground
            .try_borrow_mut()
            .map_err(io::Error::other)?
            .intrude_basement(source, catalogue::GRANITE, shell)?;
        let [x, y] = field.mesh.position(source);
        field.events.push(Event {
            id: format!("volcano:arc:{source}:{}", context.epoch_index),
            kind: EventKind::Volcano,
            x,
            y,
            radius: eruption.radius,
            epoch: context.epoch_index.max(0),
            strength: field.shared.scalar(S::VolcanicActivity).get(source)?,
            caldera: None,
        });
    }
    for cell in 0..field.mesh.len() {
        field
            .shared
            .scalar_mut(S::OceanicSubduction)
            .set(cell, 0.0)?;
    }
    Ok(())
}
impl Field {
    pub fn volcanic_construction(settings: Settings) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "volcanic-construction",
            CommandKind::Event,
            vec![],
            move |scope, context: &PhysicalContext| {
                let mut settings = settings.clone();
                if let Some(height) = context.volcanic_height {
                    settings.volcanic_cone_height = height;
                }
                scope
                    .state_mut()
                    .erupt_volcanoes(&settings, context)
                    .map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
    fn erupt_volcanoes(&mut self, p: &Settings, context: &PhysicalContext) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            self.shared.scalar_mut(S::VolcanicActivity).set(cell, 0.0)?;
        }
        if p.volcanic_cone_height <= 0.0 {
            return Ok(());
        }
        let forming = !self.crust_formed;
        let clear = (1 << 6)
            | if forming {
                (1 << 8) | (1 << 9) | (1 << 10)
            } else {
                0
            };
        for cell in 0..self.mesh.len() {
            let flags = self.shared.code_mut(C::FeatureFlags);
            flags.set(cell, flags.get(cell)? & !clear)?;
        }
        let mut lava = Lava::new(self);
        let sequence = if forming { 0 } else { context.epoch_index + 1 };
        let roots: Vec<_> = self
            .events
            .iter()
            .filter(|e| matches!(e.kind, EventKind::Plume))
            .cloned()
            .collect();
        for root in roots {
            if root.strength <= 0.0 {
                continue;
            }
            let Some(source) = self.mesh.cell_at(root.x, root.y) else {
                continue;
            };
            let flags = self.shared.code_mut(C::FeatureFlags);
            flags.set(source, flags.get(source)? | (1 << 6))?;
            let eruption = lava.erupt(
                self,
                p,
                context,
                source,
                melt_volume(p, context, root.strength),
            )?;
            if eruption.volume <= 0.0 {
                continue;
            }
            self.events.push(Event {
                id: format!("volcano:{}:{sequence}", root.id),
                kind: EventKind::Volcano,
                x: root.x,
                y: root.y,
                radius: eruption.radius,
                epoch: if forming { 0 } else { context.epoch_index },
                strength: root.strength,
                caldera: None,
            });
        }
        arcs(self, p, context, &mut lava)
    }
}
