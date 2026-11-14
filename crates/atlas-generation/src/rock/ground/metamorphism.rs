//! Burial heats whole retained beds whose tops lie below the stated depth.
use super::{placement::rock_column, Ground};
use crate::{rock::transforms::heated_material, settlement::removal::Facet};
use std::io;

impl Ground {
    pub fn intrude_basement(&mut self, cell: usize, kind: usize, shell: f64) -> io::Result<()> {
        for facet in Facet::ALL {
            if self.share(cell, facet)? > 0.0 {
                self.columns
                    .intrude_basement(cell, rock_column(facet), kind, shell, self.epoch)?;
            }
        }
        self.project(cell)
    }
    pub fn metamorphose_below(&mut self, cell: usize, depth: f64) -> io::Result<()> {
        for facet in Facet::ALL {
            if self.share(cell, facet)? <= 0.0 {
                continue;
            }
            let column = rock_column(facet);
            let mut above = self.cover_depth(cell, facet)?;
            for slot in 0..=self.columns.deepest(cell, column)? {
                let material = self.columns.read_layer(cell, column, slot)?;
                if above >= depth {
                    self.columns.set_layer(
                        cell,
                        column,
                        slot,
                        &heated_material(&material, self.epoch),
                    )?;
                }
                above += material.depth;
            }
        }
        self.project(cell)
    }
    pub fn completed_epochs(&self) -> f64 {
        self.epoch
    }
    pub fn complete_epoch(&mut self) {
        self.epoch += 1.0;
    }
    pub fn capture_completed_epochs(&mut self, epochs: usize) {
        self.epoch = epochs as f64;
    }
    pub fn effective_sea_level(&self) -> f64 {
        self.sea_level
    }
    pub fn receive_sea_level(&mut self, level: f64) {
        self.sea_level = level;
    }
}
