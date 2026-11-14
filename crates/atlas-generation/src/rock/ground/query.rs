//! Caller-owned queries visit material without acquiring its writers.
use super::{
    placement::{cover_column, rock_column},
    Ground, GroundField as F,
};
use crate::{
    rock::{
        catalogue::{self, RockKind},
        material::MaterialLayer,
    },
    scale::MapScale,
    settlement::removal::Facet,
};
use std::io;
pub struct GroundLayer {
    pub kind: &'static RockKind,
    pub strength: f64,
    pub thickness: f64,
    pub retained_thickness: f64,
    pub material: MaterialLayer,
}
impl GroundLayer {
    fn material(material: MaterialLayer, loose: bool, basement: bool) -> Self {
        Self {
            kind: catalogue::kind_of_code(material.kind),
            strength: material.material_strength(
                loose,
                catalogue::kind_of_code(catalogue::ALLUVIUM)
                    .facts
                    .resistance,
            ),
            thickness: material.depth,
            retained_thickness: (material.depth - f64::from(basement)).max(0.0),
            material,
        }
    }
    fn plain(code: usize, thickness: f64) -> Self {
        let kind = catalogue::kind_of_code(code);
        Self {
            kind,
            strength: kind.facts.resistance,
            thickness,
            retained_thickness: thickness,
            material: catalogue::material(code, thickness, 0.0),
        }
    }
}
pub struct GroundHere {
    pub tree: f64,
    pub grass: f64,
    pub wetland: f64,
    pub fire: f64,
    pub fracture: f64,
    pub ward: f64,
    pub stiffening: f64,
}
pub type Visit<'a, T> = Box<dyn Fn(T, &GroundLayer, &GroundHere) -> T + 'a>;
pub type Across<'a, T> = Box<dyn Fn(T, T, f64) -> T + 'a>;
pub struct GroundQuery<'a, T> {
    pub start: T,
    pub soil: Option<Visit<'a, T>>,
    pub loose: Option<Visit<'a, T>>,
    pub ice: Option<Visit<'a, T>>,
    pub rock: Option<Visit<'a, T>>,
    pub crust: Option<Visit<'a, T>>,
    pub through_column: bool,
    pub across_facets: Option<Across<'a, T>>,
}
impl<T> GroundQuery<'_, T> {
    pub fn new(start: T) -> Self {
        Self {
            start,
            soil: None,
            loose: None,
            ice: None,
            rock: None,
            crust: None,
            through_column: false,
            across_facets: None,
        }
    }
}
pub fn average(mut query: GroundQuery<'_, f64>) -> GroundQuery<'_, f64> {
    query.across_facets = Some(Box::new(|land, cut, share| {
        land * (1.0 - share) + cut * share
    }));
    query
}
#[derive(Clone, Copy)]
pub enum Fact {
    Resistance,
    Jointing,
    Bedding,
    Solubility,
    Porosity,
}
pub fn material_fact(material: &MaterialLayer, fact: Fact) -> f64 {
    let value = |code| {
        let kind = catalogue::kind_of_code(code);
        match fact {
            Fact::Resistance => material.strength,
            Fact::Jointing => kind.facts.jointing,
            Fact::Bedding => kind.facts.bedding,
            Fact::Solubility => kind.facts.solubility,
            Fact::Porosity => kind.facts.porosity,
        }
    };
    let primary = value(material.kind);
    primary + (value(material.secondary_kind) - primary) * material.secondary_share
}
pub fn ground_fact(layer: &GroundLayer, fact: Fact) -> f64 {
    if matches!(fact, Fact::Resistance) {
        layer.strength
    } else {
        material_fact(&layer.material, fact)
    }
}
impl Ground {
    pub fn fold<T: Clone>(
        &self,
        cell: usize,
        query: &GroundQuery<'_, T>,
        facet: Option<Facet>,
    ) -> io::Result<T> {
        let share = self.share(cell, Facet::Cut)?;
        if let Some(across) = &query.across_facets {
            if facet.is_none() && share > 0.0 && share < 1.0 {
                return Ok(across(
                    self.fold(cell, query, Some(Facet::Land))?,
                    self.fold(cell, query, Some(Facet::Cut))?,
                    share,
                ));
            }
        }
        let facet = facet.unwrap_or(if share > 0.5 { Facet::Cut } else { Facet::Land });
        if self.share(cell, facet)? <= 0.0 {
            return Ok(query.start.clone());
        }
        let here = self.here(cell)?;
        let value = self.fold_cover(cell, query, facet, &here)?;
        let Some(rock) = &query.rock else {
            return Ok(value);
        };
        let column = rock_column(facet);
        let mut layer = GroundLayer::material(
            self.columns.read_layer(cell, column, 0)?,
            false,
            self.columns.depth(cell, column, 1)? <= 0.0,
        );
        let mut value = rock(value, &layer, &here);
        if !query.through_column {
            return Ok(value);
        }
        for slot in 1..column.size() {
            let material = self.columns.read_layer(cell, column, slot)?;
            if material.depth <= 0.0 {
                break;
            }
            let basement =
                slot + 1 == column.size() || self.columns.depth(cell, column, slot + 1)? <= 0.0;
            layer = GroundLayer::material(material, false, basement);
            value = rock(value, &layer, &here);
        }
        if let Some(crust) = &query.crust {
            layer.thickness = self.get(F::CrustThickness, cell)?;
            layer.retained_thickness = 0.0;
            value = crust(value, &layer, &here);
        }
        Ok(value)
    }
    fn here(&self, cell: usize) -> io::Result<GroundHere> {
        Ok(GroundHere {
            tree: self.inputs.tree.get(cell)?,
            grass: self.inputs.grass.get(cell)?,
            wetland: self.inputs.wetland.get(cell)?,
            fire: self.inputs.fire.get(cell)?,
            fracture: (self.inputs.fracture.get(cell)? / 1000.0).clamp(0.0, 1.0),
            ward: self.inputs.ward.get(cell)?.clamp(0.0, 1.0),
            stiffening: match &self.inputs.stiffening {
                Some(stiffening) => stiffening.get(cell)?,
                None => 1.0,
            },
        })
    }
    fn fold_cover<T: Clone>(
        &self,
        cell: usize,
        query: &GroundQuery<'_, T>,
        facet: Facet,
        here: &GroundHere,
    ) -> io::Result<T> {
        let mut value = query.start.clone();
        let skin = self.get(F::SoilDepth, cell)?;
        if let Some(soil) = &query.soil {
            if skin > 0.0 {
                value = soil(
                    value,
                    &GroundLayer::plain(catalogue::SOIL, MapScale::native(skin)),
                    here,
                );
            }
        }
        let cover = cover_column(facet);
        if let Some(loose) = &query.loose {
            let count = if query.through_column {
                cover.size()
            } else {
                1
            };
            for slot in 0..count {
                let material = self.columns.read_layer(cell, cover, slot)?;
                if material.depth <= 0.0 {
                    continue;
                }
                let mut layer = GroundLayer::material(material, true, false);
                if !query.through_column {
                    layer.thickness = self.cover_depth(cell, facet)?;
                    layer.retained_thickness = layer.thickness;
                }
                value = loose(value, &layer, here);
            }
        }
        let thickness = self.inputs.ice.get(cell)?;
        if let Some(ice) = &query.ice {
            if thickness > 0.0 {
                value = ice(
                    value,
                    &GroundLayer::plain(catalogue::GLACIER_ICE, MapScale::native(thickness)),
                    here,
                );
            }
        }
        Ok(value)
    }
}
