//! Each owner mutation has one typed opaque command. Processes submit inputs through dispatch.
use super::{
    catalogue::{CompiledLayerMix, LayerId},
    identity::Tradition,
    HumanLayers,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError},
    storage::{Coverage, ReadBand},
    transport::TransportShares,
};
use std::io;
pub struct Lay {
    pub kind: LayerId,
    pub amount: ReadBand<f64>,
}
pub struct Move {
    pub kind: LayerId,
    pub targets: ReadBand<i32>,
    pub share: ReadBand<f64>,
    pub years: f64,
}
pub struct Placement {
    pub targets: ReadBand<i32>,
    pub share: ReadBand<f64>,
}
/// Each source offers a fraction of its current households. Receivers divide
/// that pool by share, carrying the contributing households' identities.
pub struct HouseholdTransfers {
    pub sources: Vec<(usize, f64)>,
    pub receivers: Vec<(usize, f64)>,
}
pub struct LandPlacement {
    pub kind: LayerId,
    pub movement: LandMovement,
}
pub enum LandMovement {
    Local(Placement),
    /// Portions of existing developed ground in square kilometres, from donor to recipient.
    Surveyed(Vec<(usize, usize, f64)>),
}
pub struct Convert {
    pub from: LayerId,
    pub to: LayerId,
    pub amount: ReadBand<f64>,
}
pub struct Dwelling {
    pub years: f64,
    pub fading: Option<ReadBand<f64>>,
}
pub struct Overlay {
    /// Per tradition, the code each cell's taking people adopt: above zero a tradition, below
    /// zero none (the tradition is lost), zero no change.
    pub traditions: [Option<ReadBand<i32>>; crate::human::identity::TRADITIONS],
    pub people: ReadBand<f64>,
    pub hardness: f64,
}
pub struct Rename {
    pub tradition: Tradition,
    pub from: i32,
    pub to: ReadBand<i32>,
}
pub struct Harden {
    pub years: f64,
    pub settling: f64,
}
pub struct Wear {
    pub mix: CompiledLayerMix,
    pub intensity: ReadBand<f64>,
}
pub struct Keep {
    pub cells: Vec<usize>,
    pub years: f64,
}
/// Current place declarations replace their previous contribution to maintained ways.
pub struct KeptLineTargets {
    pub add: ReadBand<f64>,
    pub at_most: ReadBand<f64>,
    pub at_least: ReadBand<f64>,
}
pub struct Apportion {
    pub kinds: Vec<LayerId>,
    pub groups: ReadBand<i32>,
    pub weight: ReadBand<f64>,
}
pub type OwnerAccess<S> = fn(&mut S) -> (&mut HumanLayers, &mut Coverage);
type Apply<P> = fn(&mut HumanLayers, &mut Coverage, &P) -> io::Result<()>;
fn command<S: 'static, P: 'static>(
    id: &str,
    kind: CommandKind,
    access: OwnerAccess<S>,
    apply: Apply<P>,
) -> Command<S, P> {
    Command::with_inputs(id, kind, vec![], move |context, input| {
        let (owner, coverage) = access(context.state_mut());
        apply(owner, coverage, input).map_err(|error| ExecutionError::Failed(error.to_string()))
    })
}
pub struct Operations<S> {
    pub lay: Command<S, Lay>,
    pub move_layer: Command<S, Move>,
    pub place_households: Command<S, Vec<HouseholdTransfers>>,
    pub place_ruins: Command<S, Placement>,
    pub place_land: Command<S, LandPlacement>,
    pub convert: Command<S, Convert>,
    pub dwell: Command<S, Dwelling>,
    pub forget: Command<S, f64>,
    pub overlay: Command<S, Overlay>,
    pub rename: Command<S, Rename>,
    pub inherit: Command<S>,
    pub harden: Command<S, Harden>,
    pub reexpose_identity: Command<S, ReadBand<f64>>,
    pub wear: Command<S, Wear>,
    pub bury: Command<S, ReadBand<f64>>,
    pub reexpose: Command<S, ReadBand<f64>>,
    pub travel: Command<S, ReadBand<f64>>,
    pub keep: Command<S, Keep>,
    pub maintain_lines: Command<S, KeptLineTargets>,
    pub apportion: Command<S, Apportion>,
    pub carry: Command<S, TransportShares>,
}
impl<S: 'static> Operations<S> {
    pub fn new(access: OwnerAccess<S>) -> Self {
        use CommandKind::{Elapsed, Event, Work};
        Self {
            place_households: command(
                "human.layers.place-households",
                Work,
                access,
                |owner, _, p| owner.place_households(p),
            ),
            lay: command("human.layers.lay", Work, access, |owner, _, input| {
                owner.lay(input)
            }),
            place_ruins: command(
                "human.remains.place",
                Work,
                access,
                |owner, coverage, input| owner.place_ruins(input, coverage),
            ),
            place_land: command(
                "human.land-use.place",
                Work,
                access,
                |owner, coverage, input| owner.place_land(input, coverage),
            ),
            move_layer: command(
                "human.layers.move",
                Work,
                access,
                |owner, coverage, input| owner.move_layer(input, coverage),
            ),
            convert: command("human.layers.convert", Work, access, |owner, _, input| {
                owner.convert(input)
            }),
            dwell: command("human.layers.dwell", Elapsed, access, |owner, _, input| {
                owner.dwell(input)
            }),
            forget: command("human.layers.forget", Elapsed, access, |owner, _, input| {
                owner.forget(*input, None)
            }),
            overlay: command("human.identity.overlay", Work, access, |owner, _, input| {
                owner.overlay(input)
            }),
            rename: command("human.identity.rename", Event, access, |owner, _, input| {
                owner.rename(input)
            }),
            inherit: command("human.identity.inherit", Work, access, |owner, _, _| {
                owner.inherit()
            }),
            harden: command(
                "human.identity.harden",
                Elapsed,
                access,
                |owner, _, input| owner.harden(input),
            ),
            reexpose_identity: command(
                "human.identity.re-expose",
                Work,
                access,
                |owner, _, input| owner.reexpose_identity(input),
            ),
            wear: command("human.layers.wear", Work, access, |owner, _, input| {
                owner.wear(input)
            }),
            bury: command("human.layers.bury", Work, access, |owner, _, input| {
                owner.bury(input)
            }),
            reexpose: command("human.layers.re-expose", Work, access, |owner, _, input| {
                owner.reexpose(input)
            }),
            travel: command("human.layers.travel", Elapsed, access, |owner, _, input| {
                owner.travel(input)
            }),
            keep: command("human.layers.keep", Elapsed, access, |owner, _, input| {
                owner.keep(input)
            }),
            maintain_lines: command(
                "human.records.maintain-lines",
                Work,
                access,
                |owner, coverage, input| owner.maintain_lines(input, coverage),
            ),
            apportion: command(
                "human.layers.apportion",
                Event,
                access,
                |owner, _, input| owner.apportion(input),
            ),
            carry: command(
                "human.layers.carry",
                Event,
                access,
                |owner, coverage, input| owner.carry(input, coverage),
            ),
        }
    }
}
