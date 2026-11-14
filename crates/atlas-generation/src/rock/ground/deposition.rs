//! Incoming sediment fills lower occupied facets before the higher surface.
use super::Ground;
use crate::{
    rock::material::MaterialLayer,
    settlement::{
        removal::Facet,
        stage::{Deposit, Pool},
    },
};
use std::io;

pub fn pond_level(land: f64, land_share: f64, cut: f64, cut_share: f64, mean_depth: f64) -> f64 {
    if land_share <= 0.0 {
        return cut + mean_depth / cut_share;
    }
    if cut_share <= 0.0 {
        return land + mean_depth / land_share;
    }
    let lower = land.min(cut);
    let upper = land.max(cut);
    let lower_share = if land <= cut { land_share } else { cut_share };
    let room = (upper - lower) * lower_share;
    if mean_depth <= room {
        lower + mean_depth / lower_share
    } else {
        upper + (mean_depth - room) / (land_share + cut_share)
    }
}
impl Ground {
    pub fn deposit_pond(
        &mut self,
        action: Deposit<'_>,
        maximum_surface: f64,
        from: Pool,
    ) -> io::Result<f64> {
        let cell = action.cell;
        let level = maximum_surface.min(pond_level(
            self.surface(cell, Facet::Land)?,
            self.share(cell, Facet::Land)?,
            self.surface(cell, Facet::Cut)?,
            self.share(cell, Facet::Cut)?,
            action.amount.max(0.0),
        ));
        let mut accepted = 0.0;
        for facet in Facet::ALL {
            let depth = (level - self.surface(cell, facet)?).max(0.0) * self.share(cell, facet)?;
            if depth > 0.0 {
                accepted += self.deposit_package(
                    cell,
                    &[MaterialLayer {
                        depth,
                        ..action.material.clone()
                    }],
                    action.cause,
                    from,
                    Some(facet),
                )?;
            }
        }
        Ok(accepted)
    }
    pub fn settled_from_sea(&mut self, volume: f64) {
        self.exported = (self.exported - volume).max(0.0);
    }
}
