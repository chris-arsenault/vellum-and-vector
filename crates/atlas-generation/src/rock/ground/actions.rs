//! Top-down actions ask the same mode/material bridge as surface and exposed-face queries.
use super::{
    placement::{cover_column, rock_column},
    Ground, GroundField as F,
};
use crate::{
    rock::{catalogue, material_gives, CompiledMix},
    scale::{LengthUnit, MapScale, RelativeMeasure},
    settlement::{removal::Facet, stage::SurfaceAction},
};
use std::io;
#[derive(Clone, Copy, Default)]
pub struct GroundTaken {
    pub soil: f64,
    pub loose: f64,
    pub ice: f64,
    pub rock: f64,
    pub crust: f64,
}
enum Part {
    Soil,
    Loose,
    Rock,
    Crust,
}
struct Action {
    left: f64,
    reached: f64,
    limit: f64,
    took: GroundTaken,
}
impl Action {
    fn new(power: f64, limit: f64) -> Self {
        Self {
            left: power,
            reached: 0.0,
            limit: MapScale::metres(limit, LengthUnit::Native),
            took: GroundTaken::default(),
        }
    }
    fn take(&mut self, rate: f64, thickness: f64, part: Part) {
        if thickness <= 0.0 {
            return;
        }
        if rate <= 0.0 {
            self.left = 0.0;
            return;
        }
        let taken = thickness
            .min(self.left * rate)
            .min(self.limit - self.reached)
            .max(0.0);
        self.reached += taken;
        match part {
            Part::Soil => self.took.soil += taken,
            Part::Loose => self.took.loose += taken,
            Part::Rock => self.took.rock += taken,
            Part::Crust => self.took.crust += taken,
        }
        self.left -= taken / rate;
    }
}
impl Ground {
    pub(super) fn bearing(&self, cell: usize, mix: &CompiledMix) -> io::Result<f64> {
        let fracture = (self.inputs.fracture.get(cell)? / 1000.0).clamp(0.0, 1.0);
        let ward = self.inputs.ward.get(cell)?.clamp(0.0, 1.0);
        let mut bearing = (mix.fractures_weaken * fracture).exp() / (1.0 + mix.ward_holds * ward);
        if let Some(stiffen) = &self.inputs.stiffening {
            bearing /= stiffen.get(cell)?;
        }
        if mix.cover_holds > 0.0 {
            if let Some(hold) = &self.inputs.root_hold {
                let remaining =
                    hold.get(cell)? * (1.0 - 0.5 * self.inputs.fire.get(cell)?).max(0.0);
                bearing /= 1.0 + mix.cover_holds * remaining;
            }
        }
        Ok(bearing)
    }
    pub fn act_on(&self, input: SurfaceAction<'_>, facet: Facet) -> io::Result<f64> {
        let facet = if facet == Facet::Cut && self.share(input.cell, Facet::Cut)? <= 0.0 {
            Facet::Land
        } else {
            facet
        };
        let bearing = self.bearing(input.cell, input.mix)?;
        let mut action = Action::new(input.power, input.limit);
        let skin = self.get(F::SoilDepth, input.cell)?.max(0.0);
        let soil = catalogue::kind_of_code(catalogue::SOIL);
        action.take(
            (input.mix.given_up(soil.code, soil.facts.resistance) * bearing).max(0.0),
            skin,
            Part::Soil,
        );
        let cover = cover_column(facet);
        let mut masked = skin;
        for slot in 0..cover.size() {
            if action.left <= 0.0 {
                break;
            }
            let layer = self.columns.read_layer(input.cell, cover, slot)?;
            let depth = MapScale::metres(layer.depth, LengthUnit::Native);
            let exposed = (depth - masked).max(0.0);
            masked = (masked - depth).max(0.0);
            action.take(
                material_gives(input.mix, &layer.interaction(), true, input.direction) * bearing,
                exposed,
                Part::Loose,
            );
        }
        if action.left > 0.0 {
            self.walk_rock(&input, facet, masked, &mut action)?;
        }
        self.last_action.set((input.cell, action.took));
        Ok(MapScale::native(action.reached).min(input.limit))
    }
    pub fn rock_action(&self, input: SurfaceAction<'_>, facet: Facet) -> io::Result<f64> {
        self.last_action.set((input.cell, GroundTaken::default()));
        if self.share(input.cell, facet)? <= 0.0 {
            return Ok(0.0);
        }
        let mut action = Action::new(input.power, input.limit);
        self.walk_rock(&input, facet, 0.0, &mut action)?;
        self.last_action.set((input.cell, action.took));
        Ok(MapScale::native(action.reached).min(input.limit))
    }
    fn walk_rock(
        &self,
        input: &SurfaceAction<'_>,
        facet: Facet,
        mut masked: f64,
        action: &mut Action,
    ) -> io::Result<()> {
        let column = rock_column(facet);
        let last = self.columns.deepest(input.cell, column)?;
        let bearing = self.bearing(input.cell, input.mix)?;
        for slot in 0..=last {
            if action.left <= 0.0 || action.reached >= action.limit {
                break;
            }
            let layer = self.columns.read_layer(input.cell, column, slot)?;
            let depth = if slot == last {
                f64::INFINITY
            } else {
                MapScale::metres(layer.depth, LengthUnit::Native)
            };
            action.take(
                material_gives(input.mix, &layer.interaction(), false, input.direction) * bearing,
                (depth - masked).max(0.0),
                if slot == last {
                    Part::Crust
                } else {
                    Part::Rock
                },
            );
            masked = (masked - depth).max(0.0);
        }
        Ok(())
    }
    pub fn taken(&self, cell: usize) -> GroundTaken {
        let (at, took) = self.last_action.get();
        if at == cell {
            took
        } else {
            self.last_action.set((cell, GroundTaken::default()));
            GroundTaken::default()
        }
    }
    pub(super) fn surface_depths(&self, input: SurfaceAction<'_>) -> io::Result<[f64; 2]> {
        let mut depths = [0.0; 2];
        for (index, facet) in Facet::ALL.into_iter().enumerate() {
            if self.share(input.cell, facet)? > 0.0 {
                depths[index] = self.act_on(SurfaceAction { ..input }, facet)?;
            }
        }
        Ok(depths)
    }
    pub fn gives(&self, cell: usize, mix: &CompiledMix, direction: [f64; 2]) -> io::Result<f64> {
        let bearing = self.bearing(cell, mix)?;
        let share = self.share(cell, Facet::Cut)?;
        let beneath = bearing
            * ((1.0 - share) * self.facet_gives(cell, mix, Facet::Land, direction)?
                + share * self.facet_gives(cell, mix, Facet::Cut, direction)?);
        let full_soil = self
            .scale
            .resolve(RelativeMeasure::length(0.00000025).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value();
        let skin = (self.get(F::SoilDepth, cell)? / full_soil).clamp(0.0, 1.0);
        let soil = catalogue::kind_of_code(catalogue::SOIL);
        Ok(beneath
            + ((mix.given_up(soil.code, soil.facts.resistance) * bearing).max(0.0) - beneath)
                * skin)
    }
    fn facet_gives(
        &self,
        cell: usize,
        mix: &CompiledMix,
        facet: Facet,
        direction: [f64; 2],
    ) -> io::Result<f64> {
        let rock = self.columns.read_layer(cell, rock_column(facet), 0)?;
        let loose = self.columns.read_layer(cell, cover_column(facet), 0)?;
        let full_cover = self
            .scale
            .resolve(RelativeMeasure::length(0.00000625).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value();
        let share = (self.cover_depth(cell, facet)? / MapScale::native(full_cover)).clamp(0.0, 1.0);
        let response = material_gives(mix, &rock.interaction(), false, direction);
        Ok(response
            + (material_gives(mix, &loose.interaction(), true, direction) - response) * share)
    }
}
