use super::{land::mix, travel::length, work::working};
use crate::{
    execution::{Command, CommandKind},
    field::{shared::Scalar as S, Field},
    human::{
        catalogue::{self, LayerMode},
        operations::{self, Wear},
    },
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
    storage::Band,
};
use std::{io, rc::Rc};

// Arconis: docs/architecture/subsystems.arconis#item=pp_meet — records land that drowned, buried, scoured or struck people.
pub struct Seen {
    laid: Band<f64>,
    stripped: Band<f64>,
    struck: Band<f64>,
}
impl Seen {
    fn new(field: &Field) -> Self {
        let kept = || field.coverage.borrow_mut().allocate(0.0);
        Self {
            laid: kept(),
            stripped: kept(),
            struck: kept(),
        }
    }
    fn look(&mut self, field: &Field) -> io::Result<()> {
        for cell in 0..field.mesh.len() {
            let [laid, stripped, struck] = metres(field, cell)?;
            self.laid.set(cell, laid)?;
            self.stripped.set(cell, stripped)?;
            self.struck.set(cell, struck)?;
        }
        Ok(())
    }
}
fn metres(field: &Field, cell: usize) -> io::Result<[f64; 3]> {
    let read = |name| field.shared.scalar(name).get(cell);
    Ok([
        MapScale::metres(
            field
                .ground()
                .view(GroundField::CumulativeDeposition)
                .get(cell)?
                + read(S::CumulativeGlacialDeposition)?
                + read(S::VolcanicConstructionHistory)?
                + read(S::ImpactEjectaThickness)?,
            LengthUnit::Native,
        ),
        MapScale::metres(
            read(S::CumulativeGlacialErosion)? + read(S::CumulativeCoastalErosion)?,
            LengthUnit::Native,
        ),
        MapScale::metres(read(S::ImpactExcavation)?, LengthUnit::Native),
    ])
}
fn look(field: &mut Field) -> io::Result<()> {
    let mut seen = field
        .human_land_seen
        .take()
        .unwrap_or_else(|| Seen::new(field));
    seen.look(field)?;
    field.human_land_seen = Some(seen);
    Ok(())
}
pub struct Operations {
    pub watch: Command<Field>,
    pub meet: Command<Field>,
}
impl Operations {
    pub fn new(owner: Rc<operations::Operations<Field>>) -> Self {
        Self {
            watch: Command::with_inputs(
                "human.land.watch",
                CommandKind::Event,
                vec![],
                |context, _| Ok(look(context.state_mut())?),
            ),
            meet: Command::with_inputs(
                "human.land.meet",
                CommandKind::Event,
                vec![],
                move |context, _| {
                    let field = context.state();
                    let mut covered = working(field);
                    let mut bared = working(field);
                    let mut wrecked = working(field);
                    let mut scoured = working(field);
                    let thick = length(field, 0.00025)?;
                    let since =
                        |now: f64, before: f64| 1.0 - (-(now - before).max(0.0) / 3.0).exp();
                    for cell in 0..field.mesh.len() {
                        let under = field.water().column.kind.get(cell)? != 0;
                        scoured.set(
                            cell,
                            field.shared.scalar(S::IceThickness).get(cell)? / thick,
                        )?;
                        covered.set(cell, f64::from(under))?;
                        if let Some(before) = &field.human_land_seen {
                            let [laid, stripped, struck] = metres(field, cell)?;
                            if !under {
                                covered.set(cell, since(laid, before.laid.get(cell)?))?;
                            }
                            bared.set(cell, since(stripped, before.stripped.get(cell)?))?;
                            wrecked.set(cell, (struck - before.struck.get(cell)?).max(0.0))?;
                        }
                    }
                    let mut striking = [0.0; 7];
                    striking[LayerMode::Shake as usize] = 0.5;
                    striking[LayerMode::Burn as usize] = 0.5;
                    context.run(
                        &owner.wear,
                        &Wear {
                            mix: catalogue::compile(striking),
                            intensity: wrecked.read_only(),
                        },
                    )?;
                    context.run(
                        &owner.wear,
                        &Wear {
                            mix: mix(LayerMode::Scour),
                            intensity: scoured.read_only(),
                        },
                    )?;
                    context.run(&owner.bury, &covered.read_only())?;
                    context.run(&owner.reexpose, &bared.read_only())?;
                    if context.state().human_land_seen.is_some() {
                        look(context.state_mut())?;
                    }
                    Ok(())
                },
            ),
        }
    }
}
