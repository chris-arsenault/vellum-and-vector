use super::{
    canyon::{Canyon, CanyonCapture, CanyonWork},
    catalogue::{Kind, Measures},
    escarpment::{Escarpment, ScarpWork},
    falls::{Falls, FallsCapture, FallsWork},
    magic::{self, Scene},
    mountains::{Measures as MountainMeasures, Mountain, MountainWork},
    placement::Placed,
    rings::{CraterMeasures, Dome, DomeWork, ImpactRing, ImpactRingWork},
};
use crate::{
    execution::{Command, CommandContext, ExecutionError, ExecutionResult, Executor, Query},
    field::{impacts, Field},
    spatial::SpatialKernel,
};
use std::rc::Rc;
pub struct Operations {
    mountain: Query<Field, MountainMeasures>,
    dome: Query<Field, f64>,
    impact: Query<Field, CraterMeasures>,
    scarp: Query<Field, f64>,
    canyon: Query<Field, f64>,
    falls: Query<Field, f64>,
    volcanic_write: Command<Field, MountainWork>,
    mountain_write: Command<Field, MountainWork>,
    dome_write: Command<Field, DomeWork>,
    impact_write: Command<Field, ImpactRingWork>,
    scarp_write: Command<Field, ScarpWork>,
    canyon_write: Command<Field, CanyonWork>,
    falls_write: Command<Field, FallsWork>,
    canyon_capture: Command<Field, CanyonCapture>,
    falls_capture: Command<Field, FallsCapture>,
}
impl Operations {
    pub fn new(
        kernel: Rc<dyn SpatialKernel>,
        impact: Rc<impacts::settings::Settings>,
        volcanic_resistance: f64,
        fracture_strength: f64,
    ) -> Self {
        Self {
            mountain: Field::mountain_measures(),
            dome: Field::dome_ring_measure(),
            impact: Field::impact_ring_measures(),
            scarp: Field::escarpment_measure(kernel.clone()),
            canyon: Field::canyon_measure(kernel.clone()),
            falls: Field::falls_measure(),
            volcanic_write: Field::landmark_mountain(true, volcanic_resistance),
            mountain_write: Field::landmark_mountain(false, volcanic_resistance),
            dome_write: Field::landmark_dome_ring(),
            impact_write: Field::landmark_impact_ring(impact),
            scarp_write: Field::landmark_escarpment(kernel.clone(), fracture_strength),
            canyon_write: Field::landmark_canyon(kernel.clone()),
            falls_write: Field::landmark_falls(),
            canyon_capture: Field::capture_canyon_river(kernel.clone()),
            falls_capture: Field::capture_falls_river(kernel),
        }
    }
    pub fn select_queries(&self, executor: &mut Executor<Field>) {
        executor.select(&self.mountain);
        executor.select(&self.dome);
        executor.select(&self.impact);
        executor.select(&self.scarp);
        executor.select(&self.canyon);
        executor.select(&self.falls);
    }
    pub fn select_in(&self, selection: &mut crate::execution::Selection<'_, Field>) {
        selection.select(&self.mountain);
        selection.select(&self.dome);
        selection.select(&self.impact);
        selection.select(&self.scarp);
        selection.select(&self.canyon);
        selection.select(&self.falls);
    }
    pub fn measure(
        &self,
        context: &CommandContext<'_, Field>,
        placed: &Placed<'_>,
        scene: &Scene,
    ) -> ExecutionResult<Measures> {
        let mut measured = Measures::new();
        match placed.landmark.kind {
            Kind::VolcanicMountain | Kind::ResistantMountain => {
                let m = context.query_with_context(&self.mountain, Rc::new(mountain(placed)))?;
                measured.insert("summit".into(), m.summit);
                measured.insert("prominence".into(), m.prominence);
            }
            Kind::ImpactRing => {
                let m = context.query_with_context(&self.impact, Rc::new(impact(placed)))?;
                measured.insert("floorDepth".into(), m.floor_depth);
                measured.insert("rimHeight".into(), m.rim_height);
            }
            Kind::DomeRing => {
                measured.insert(
                    "ringRelief".into(),
                    *context.query_with_context(&self.dome, Rc::new(dome(placed)))?,
                );
            }
            Kind::Escarpment => {
                measured.insert(
                    "throw".into(),
                    *context.query_with_context(&self.scarp, Rc::new(scarp(placed)))?,
                );
            }
            Kind::Canyon => {
                measured.insert(
                    "depth".into(),
                    *context.query_with_context(&self.canyon, Rc::new(canyon(placed)))?,
                );
            }
            Kind::Falls => {
                measured.insert(
                    "drop".into(),
                    *context.query_with_context(&self.falls, Rc::new(falls(placed)))?,
                );
            }
            _ => {
                measured.insert(
                    "intensity".into(),
                    magic::measure(context.state(), placed, scene)
                        .map_err(|e| ExecutionError::Failed(e.to_string()))?,
                );
            }
        }
        Ok(measured)
    }
    pub fn capture(
        &self,
        context: &mut CommandContext<'_, Field>,
        placed: &Placed<'_>,
        book: bool,
    ) -> ExecutionResult<()> {
        match placed.landmark.kind {
            Kind::Canyon => context.run(
                &self.canyon_capture,
                &CanyonCapture {
                    canyon: canyon(placed),
                    book,
                },
            ),
            Kind::Falls => context.run(
                &self.falls_capture,
                &FallsCapture {
                    falls: falls(placed),
                    book,
                },
            ),
            _ => Ok(()),
        }
    }
    pub fn apply(
        &self,
        context: &mut CommandContext<'_, Field>,
        placed: &Placed<'_>,
        epoch: i32,
        scene: &Scene,
        shortfall: Option<&Measures>,
    ) -> ExecutionResult<()> {
        let missing = |key: &str| shortfall.map(|m| m.get(key).copied().unwrap_or(0.0));
        let id = placed.landmark.id;
        match placed.landmark.kind {
            Kind::VolcanicMountain | Kind::ResistantMountain => {
                let command = if placed.landmark.kind == Kind::VolcanicMountain {
                    &self.volcanic_write
                } else {
                    &self.mountain_write
                };
                context.run(
                    command,
                    &MountainWork {
                        landmark_id: id,
                        mountain: mountain(placed),
                        epoch,
                        prominence_shortfall: missing("prominence"),
                    },
                )
            }
            Kind::DomeRing => context.run(
                &self.dome_write,
                &DomeWork {
                    landmark_id: id,
                    dome: dome(placed),
                    relief_shortfall: missing("ringRelief"),
                },
            ),
            Kind::ImpactRing => context.run(
                &self.impact_write,
                &ImpactRingWork {
                    landmark_id: id,
                    ring: impact(placed),
                    shortfall: shortfall.map(|m| CraterMeasures {
                        floor_depth: m.get("floorDepth").copied().unwrap_or(0.0),
                        rim_height: m.get("rimHeight").copied().unwrap_or(0.0),
                    }),
                },
            ),
            Kind::Escarpment => context.run(
                &self.scarp_write,
                &ScarpWork {
                    scarp: scarp(placed),
                    throw_shortfall: missing("throw"),
                },
            ),
            Kind::Canyon => context.run(
                &self.canyon_write,
                &CanyonWork {
                    canyon: canyon(placed),
                    depth_shortfall: missing("depth"),
                },
            ),
            Kind::Falls => context.run(
                &self.falls_write,
                &FallsWork {
                    falls: falls(placed),
                    drop_shortfall: missing("drop"),
                },
            ),
            _ => magic::apply(
                context.state_mut(),
                placed,
                scene,
                epoch,
                missing("intensity"),
            )
            .map_err(|e| ExecutionError::Failed(e.to_string())),
        }
    }
}
fn mountain(p: &Placed<'_>) -> Mountain {
    let m = &p.landmark.parameters;
    Mountain {
        center: p.center,
        base_radius_km: m["baseRadius"],
        summit_metres: m["summit"],
        prominence_metres: m["prominence"],
    }
}
fn dome(p: &Placed<'_>) -> Dome {
    let m = &p.landmark.parameters;
    Dome {
        center: p.center,
        diameter_km: m["diameter"],
        ring_count: m["ringCount"],
        ring_relief: m["ringRelief"],
    }
}
fn impact(p: &Placed<'_>) -> ImpactRing {
    let m = &p.landmark.parameters;
    ImpactRing {
        center: p.center,
        diameter_km: m["diameter"],
        floor_depth: m["floorDepth"],
        rim_height: m["rimHeight"],
    }
}
fn scarp(p: &Placed<'_>) -> Escarpment {
    let m = &p.landmark.parameters;
    Escarpment {
        id: p.landmark.id,
        path: p.path.clone(),
        width_km: m["scarpWidth"],
        throw_metres: m["throw"],
    }
}
fn canyon(p: &Placed<'_>) -> Canyon {
    let m = &p.landmark.parameters;
    Canyon {
        id: p.landmark.id,
        path: p.path.clone(),
        rim_width_km: m["rimWidth"],
        depth_metres: m["depth"],
        capture_distance_km: m["captureDistance"],
    }
}
fn falls(p: &Placed<'_>) -> Falls {
    let m = &p.landmark.parameters;
    Falls {
        id: p.landmark.id,
        center: p.center,
        drop_metres: m["drop"],
        capture_distance_km: m["captureDistance"],
    }
}
