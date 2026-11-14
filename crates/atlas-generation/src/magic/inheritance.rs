//! Captured magic channels retain sites and material ownership as in magicInheritance.ts.
use super::{
    channels::{Channel, Quantity as ChannelQuantity},
    configuration::Source,
    inventory::Inventory,
    state::MagicField,
};
use crate::{
    lattice::TriangularLattice,
    reconstruction::{
        surface::{Sampler, Surface},
        Layout,
    },
    storage::{Band, Coverage, ReadBand},
};
use std::io;
#[derive(Clone, Copy, PartialEq)]
pub enum Quantity {
    Intensive,
    Extensive,
    Category,
    SiteAmount,
    SiteStrength,
}
pub struct Inheritance<'a> {
    pub mesh: &'a TriangularLattice,
    pub regional: bool,
    pub channels: &'a [Captured<'a>],
    pub impacts: &'a [String],
}
pub struct Captured<'a> {
    pub key: String,
    pub surface: Surface<'a>,
}
pub fn source_sites(values: &ReadBand<f64>) -> io::Result<Vec<i32>> {
    let mut cells = Vec::new();
    for cell in 0..values.len() {
        if values.get(cell)? > 0.0 {
            cells.push(cell as i32);
        }
    }
    Ok(cells)
}
impl Inheritance<'_> {
    pub fn present_intensity(
        &self,
        field: &mut MagicField,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        self.channel(
            &format!("magic:{}:intensity", field.definition.id),
            field.channels.band_mut(Channel::Intensity),
            Quantity::Intensive,
            coverage,
        )?;
        Ok(())
    }
    pub fn society(
        &self,
        people: &mut crate::human::HumanSeed,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        use crate::human::HumanField;
        for (name, field, quantity) in [
            ("Tenure", HumanField::Tenure, Quantity::SiteAmount),
            ("WalkedRoute", HumanField::WalkedRoute, Quantity::Extensive),
            ("KeptLine", HumanField::KeptLine, Quantity::Extensive),
            ("MassDeath", HumanField::MassDeath, Quantity::Extensive),
        ] {
            let mut values = coverage.scratch(self.mesh.len(), 0.0);
            if self.channel(name, &mut values, quantity, coverage)? {
                for cell in 0..self.mesh.len() {
                    people.initialize(field, cell, values.get(cell)?)?;
                }
            }
        }
        Ok(())
    }
    pub fn channel(
        &self,
        key: &str,
        into: &mut Band<f64>,
        quantity: Quantity,
        coverage: &mut Coverage,
    ) -> io::Result<bool> {
        let Some(captured) = self.channels.iter().find(|channel| channel.key == key) else {
            return Ok(false);
        };
        inherit(
            &captured.surface,
            self.mesh,
            self.regional,
            into,
            quantity,
            coverage,
        )?;
        Ok(true)
    }
    pub fn field(&self, field: &mut MagicField, coverage: &mut Coverage) -> io::Result<()> {
        if !field.definition.enabled {
            return Ok(());
        }
        let system = field.definition.id.clone();
        self.carried(field, coverage)?;
        for (definition, origin) in field.definition.origins.iter().zip(&mut field.origins) {
            for (stock, inventory) in definition.stocks.iter().zip(&mut origin.stocks) {
                let Inventory::Mobile(values) = inventory else {
                    continue;
                };
                let quantity = if stock.reservoir == "forge" {
                    Quantity::SiteAmount
                } else {
                    Quantity::Extensive
                };
                self.channel(
                    &format!("magic:{system}:stock:{}/{}", definition.id, stock.id),
                    values,
                    quantity,
                    coverage,
                )?;
            }
            let quantity = if matches!(
                definition.source,
                Source::Geothermal | Source::DeepOcean | Source::Placed | Source::Forge
            ) {
                Quantity::SiteStrength
            } else {
                Quantity::Intensive
            };
            self.channel(
                &format!("magic:{system}:origin:{}:source", definition.id),
                &mut origin.source,
                quantity,
                coverage,
            )?;
            if matches!(definition.source, Source::Geothermal | Source::DeepOcean) {
                origin.inherited_sites = Some(source_sites(&origin.source.read_only())?);
            }
        }
        field.seeded.extend(self.impacts.iter().cloned());
        Ok(())
    }
    fn carried(&self, field: &mut MagicField, coverage: &mut Coverage) -> io::Result<()> {
        let system = field.definition.id.clone();
        for &channel in Channel::ALL {
            let definition = channel.definition();
            if !definition.carried {
                continue;
            }
            let quantity = match definition.quantity {
                ChannelQuantity::Intensive => Quantity::Intensive,
                ChannelQuantity::Extensive => Quantity::Extensive,
                ChannelQuantity::Category => Quantity::Category,
            };
            self.channel(
                &format!("magic:{system}:{}", definition.name),
                field.channels.band_mut(channel),
                quantity,
                coverage,
            )?;
        }
        Ok(())
    }
}
pub fn inherit(
    source: &Surface<'_>,
    mesh: &TriangularLattice,
    regional: bool,
    into: &mut Band<f64>,
    mut quantity: Quantity,
    coverage: &mut Coverage,
) -> io::Result<()> {
    if matches!(quantity, Quantity::SiteAmount | Quantity::SiteStrength) {
        if regional {
            return place_sites(source, mesh, into, quantity == Quantity::SiteAmount);
        }
        quantity = if quantity == Quantity::SiteAmount {
            Quantity::Extensive
        } else {
            Quantity::Intensive
        };
    }
    let mut sampler = Sampler::new(
        source,
        quantity == Quantity::Category,
        quantity == Quantity::Extensive,
        coverage,
    )?;
    let origin = mesh.origin();
    for cell in 0..into.len() {
        let p = mesh.position(cell);
        let value = sampler.sample([p[0] + origin[0], p[1] + origin[1]])?
            * if quantity == Quantity::Extensive {
                mesh.area(cell)
            } else {
                1.0
            };
        into.set(
            cell,
            if quantity == Quantity::Category {
                value
            } else {
                value.max(0.0)
            },
        )?;
    }
    Ok(())
}
fn place_sites(
    source: &Surface<'_>,
    mesh: &TriangularLattice,
    into: &mut Band<f64>,
    sum: bool,
) -> io::Result<()> {
    for cell in 0..into.len() {
        into.set(cell, 0.0)?;
    }
    let origin = mesh.origin();
    for g in 0..source.values.len() {
        let value = source.values.get(g)?;
        if value <= 0.0 {
            continue;
        }
        let p = source.grid.position(g)?;
        if mesh.cell_at(p[0] - origin[0], p[1] - origin[1]).is_none() {
            continue;
        }
        let p = source.grid.position(climb(source, g)?)?;
        let Some(cell) = mesh.cell_at(p[0] - origin[0], p[1] - origin[1]) else {
            continue;
        };
        into.set(
            cell,
            if sum {
                into.get(cell)? + value
            } else {
                into.get(cell)?.max(value)
            },
        )?;
    }
    Ok(())
}
fn climb(source: &Surface<'_>, mut g: usize) -> io::Result<usize> {
    let Layout::Raster { width, height } = source.grid.layout else {
        return Ok(g);
    };
    loop {
        let x = g % width;
        let y = g / width;
        let mut best = g;
        for ny in y.saturating_sub(1)..=(y + 1).min(height - 1) {
            for nx in x.saturating_sub(1)..=(x + 1).min(width - 1) {
                if source.values.get(ny * width + nx)? > source.values.get(best)? {
                    best = ny * width + nx;
                }
            }
        }
        if best == g {
            return Ok(g);
        }
        g = best;
    }
}
