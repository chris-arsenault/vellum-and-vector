//! Broad remembered pressures on the map's existing lattice, separate from exact holdings.
use crate::{
    checkpoint::Archive,
    storage::{Band, Coverage, ReadBand},
};
use std::io;
#[derive(Default)]
pub struct Signals {
    pub exchange: Option<Band<f64>>,
    pub waste: Option<Band<f64>>,
}
pub struct Inputs {
    pub sources: Vec<(usize, f64, f64)>,
    pub links: Vec<crate::links::Link>,
    /// People's travel friction, as the town's held environment read it this round.
    pub friction: ReadBand<f64>,
}
pub struct Transport<'a> {
    pub mesh: &'a crate::lattice::TriangularLattice,
    pub friction: ReadBand<f64>,
    pub elevation: ReadBand<f64>,
}
impl Signals {
    pub fn advance(
        &mut self,
        transport: Transport<'_>,
        coverage: &mut Coverage,
        inputs: &Inputs,
        exposure: f64,
    ) -> io::Result<()> {
        self.initialize(coverage);
        let mesh = transport.mesh;
        let mut next = coverage.allocate(0.0f64);
        let mut waste = coverage.allocate(0.0f64);
        let (old, old_waste) = self.read().unwrap();
        let response = 1.0 - (-exposure).exp();
        for cell in 0..mesh.len() {
            let mut exchange = 0.;
            let mut burden = 0.;
            let mut neighbours = 0.;
            for edge in 0..3 {
                if let Some(other) = mesh.neighbor(cell, edge) {
                    let cost =
                        (transport.friction.get(cell)? + transport.friction.get(other)?) * 0.5;
                    exchange +=
                        old.get(other)? / (1. + cost * mesh.physical_distance(cell, other) / 180.);
                    let downhill =
                        transport.elevation.get(other)? - transport.elevation.get(cell)?;
                    burden += old_waste.get(other)? / (1. + (-downhill).max(0.));
                    neighbours += 1.;
                }
            }
            let imported = exchange / (1. + neighbours) * 0.75;
            next.set(
                cell,
                old.get(cell)? + (imported - old.get(cell)?) * response,
            )?;
            waste.set(
                cell,
                (old_waste.get(cell)? * 0.8 + burden / (1. + neighbours) * 0.1)
                    * (-exposure * 0.15).exp(),
            )?;
        }
        for link in &inputs.links {
            if link.a < mesh.len() && link.b < mesh.len() {
                let attenuation = 1. / (1. + link.cost / 180.);
                next.set(
                    link.a,
                    next.get(link.a)? + old.get(link.b)? * attenuation * response,
                )?;
                next.set(
                    link.b,
                    next.get(link.b)? + old.get(link.a)? * attenuation * response,
                )?;
            }
        }
        for &(cell, activity, burden) in &inputs.sources {
            if cell < mesh.len() {
                next.set(cell, next.get(cell)? + activity * response)?;
                waste.set(cell, waste.get(cell)? + burden * response)?;
            }
        }
        self.exchange = Some(next);
        self.waste = Some(waste);
        Ok(())
    }
    pub fn initialize(&mut self, coverage: &mut Coverage) {
        if self.exchange.is_none() {
            self.exchange = Some(coverage.allocate(0.0));
            self.waste = Some(coverage.allocate(0.0));
        }
    }
    pub fn read(&self) -> Option<(ReadBand<f64>, ReadBand<f64>)> {
        self.exchange
            .as_ref()
            .zip(self.waste.as_ref())
            .map(|(a, b)| (a.read_only(), b.read_only()))
    }
    pub fn checkpoint(
        &mut self,
        archive: &mut Archive<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        archive.optional_band("town-exchange", &mut self.exchange, coverage)?;
        archive.optional_band("town-waste", &mut self.waste, coverage)
    }
}
