use super::{Ground, SectionLayer};
use crate::{
    rock::{material_gives, CompiledMix},
    scale::{LengthUnit, MapScale},
    settlement::removal::Facet,
};
use std::io;
/// A weak exposed foundation can release its finite cap; top-down wear remains blocked by that cap.
pub fn support_failure_depth(
    section: &[SectionLayer],
    floor: f64,
    direction: [f64; 2],
    run: f64,
    stable: f64,
    mix: &CompiledMix,
) -> f64 {
    if section.is_empty() || run <= 0.0 {
        return 0.0;
    }
    let surface = section[0].top;
    let gradient = MapScale::metres(surface - floor, LengthUnit::Native) / run;
    let (mut cap_response, mut cap_depth, mut failed) = (0.0, 0.0, 0.0f64);
    for layer in section {
        if layer.top <= floor {
            break;
        }
        let depth = layer.top - floor.max(if layer.basement { floor } else { layer.bottom });
        let response = material_gives(mix, &layer.material.interaction(), layer.loose, direction);
        if !layer.loose {
            let contrast = if cap_depth > 0.0 && cap_response > 0.0 {
                response / cap_response
            } else {
                0.0
            };
            if contrast > 1.0 && gradient > stable / contrast.sqrt() {
                failed = failed.max(surface - layer.top + depth);
            }
            cap_depth += depth;
            cap_response += (response - cap_response) * (depth / cap_depth);
        }
    }
    failed
}
/// Borrowing the owner prevents a captured face query from surviving a ground write.
pub struct FaceQuery<'a> {
    ground: &'a Ground,
    source: usize,
    layers: Vec<SectionLayer>,
    bearing: f64,
    mix: &'a CompiledMix,
}
pub struct FailureFace<'a> {
    ground: &'a Ground,
    source: usize,
    layers: Vec<SectionLayer>,
    bearing: f64,
    mix: &'a CompiledMix,
}
impl Ground {
    fn direction(&self, source: usize, target: usize) -> [f64; 2] {
        let [x, y] = self.mesh.position(source);
        let [nx, ny] = self.mesh.position(target);
        [self.mesh.delta_x(nx - x), ny - y]
    }
    pub fn face(&self, cell: usize, neighbor: usize) -> io::Result<Vec<SectionLayer>> {
        let mut exposed = Vec::new();
        for facet in Facet::ALL {
            let section = self.section(cell, facet)?;
            for beside in Facet::ALL {
                let share = self.share(neighbor, beside)?;
                if share <= 0.0 {
                    continue;
                }
                let floor = self.surface(neighbor, beside)?;
                for layer in &section {
                    let bottom = floor.max(if layer.basement {
                        f64::NEG_INFINITY
                    } else {
                        layer.bottom
                    });
                    if layer.top <= bottom {
                        continue;
                    }
                    let mut next = layer.clone();
                    next.bottom = bottom;
                    next.material.depth = layer.top - bottom;
                    next.share *= share;
                    exposed.push(next);
                }
            }
        }
        Ok(exposed)
    }
    pub fn face_gives_from<'a>(
        &'a self,
        source: usize,
        mix: &'a CompiledMix,
    ) -> io::Result<FaceQuery<'a>> {
        let mut layers = self.section(source, Facet::Land)?;
        layers.extend(self.section(source, Facet::Cut)?);
        Ok(FaceQuery {
            ground: self,
            source,
            layers,
            bearing: self.bearing(source, mix)?,
            mix,
        })
    }
    pub fn failure_from<'a>(
        &'a self,
        source: usize,
        facet: Facet,
        mix: &'a CompiledMix,
    ) -> io::Result<FailureFace<'a>> {
        Ok(FailureFace {
            ground: self,
            source,
            layers: self.section(source, facet)?,
            bearing: self.bearing(source, mix)?,
            mix,
        })
    }
}
impl FaceQuery<'_> {
    pub fn at(&self, neighbor: usize) -> io::Result<f64> {
        let direction = self.ground.direction(self.source, neighbor);
        let land_share = self.ground.share(neighbor, Facet::Land)?;
        let cut_share = self.ground.share(neighbor, Facet::Cut)?;
        let land_floor = self.ground.surface(neighbor, Facet::Land)?;
        let cut_floor = self.ground.surface(neighbor, Facet::Cut)?;
        let (mut response, mut extent) = (0.0, 0.0);
        for layer in &self.layers {
            let bottom = if layer.basement {
                f64::NEG_INFINITY
            } else {
                layer.bottom
            };
            let weight = layer.share
                * ((layer.top - land_floor.max(bottom)).max(0.0) * land_share
                    + (layer.top - cut_floor.max(bottom)).max(0.0) * cut_share);
            if weight <= 0.0 {
                continue;
            }
            response += material_gives(
                self.mix,
                &layer.material.interaction(),
                layer.loose,
                direction,
            ) * weight;
            extent += weight;
        }
        if extent > 0.0 {
            Ok(response / extent * self.bearing)
        } else {
            self.ground.gives(self.source, self.mix, direction)
        }
    }
}
impl FailureFace<'_> {
    pub fn at(&self, neighbor: usize, run: f64, stable: f64) -> io::Result<f64> {
        let mut floor = f64::NEG_INFINITY;
        for facet in Facet::ALL {
            if self.ground.share(neighbor, facet)? > 0.0 {
                floor = floor.max(self.ground.surface(neighbor, facet)?);
            }
        }
        Ok(support_failure_depth(
            &self.layers,
            floor,
            self.ground.direction(self.source, neighbor),
            run,
            stable / self.bearing,
            self.mix,
        ))
    }
}
