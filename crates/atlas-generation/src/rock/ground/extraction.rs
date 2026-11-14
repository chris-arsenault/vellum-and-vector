use super::{
    placement::{cover_column, rock_column},
    Ground, GroundField as F, MaterialReceiver,
};
use crate::{
    rock::{
        coarsening::coarsen_package,
        columns::Column,
        extraction::{extract_parcel, Extraction},
        material::MaterialLayer,
    },
    scale::{LengthUnit, MapScale},
    settlement::{removal::Facet, stage::Pool},
};
use std::io;
struct Extracted {
    removed: f64,
    soil: f64,
}
impl Ground {
    pub fn extract(
        &mut self,
        cell: usize,
        action: &Extraction<'_>,
        cause: &str,
        to: Pool,
        receive: &mut MaterialReceiver<'_>,
    ) -> io::Result<f64> {
        let skin = MapScale::native(self.get(F::SoilDepth, cell)?);
        let mut removed = 0.0;
        for facet in Facet::ALL {
            let share = self.share(cell, facet)?;
            if share <= 0.0 {
                continue;
            }
            let mut accept = |mut material: MaterialLayer| {
                material.depth *= share;
                receive(material)
            };
            let covered = self.cover_depth(cell, facet)?;
            let surface = self
                .section(cell, facet)?
                .first()
                .map_or(0.0, |layer| layer.material.depth);
            let reach = if action.surface_only {
                action.reach.min(surface)
            } else {
                action.reach
            };
            let loose = self.extract_column(
                cell,
                cover_column(facet),
                &action.with_extent(action.amount, reach),
                [skin, share],
                &mut accept,
            )?;
            let reach = if action.loose_only || (action.surface_only && covered > 0.0) {
                0.0
            } else {
                (reach - covered).max(0.0)
            };
            let rock = self.extract_column(
                cell,
                rock_column(facet),
                &action.with_extent((action.amount - loose.removed).max(0.0), reach),
                [(skin - covered).max(0.0), share],
                &mut accept,
            )?;
            if rock.removed > 0.0 {
                self.lower_rock(cell, rock.removed * share)?;
                self.add(
                    F::GroundCutDepth,
                    cell,
                    if facet == Facet::Cut {
                        rock.removed
                    } else {
                        -rock.removed
                    },
                )?;
            }
            let soil = MapScale::metres((loose.soil + rock.soil) * share, LengthUnit::Native);
            self.set(
                F::SoilDepth,
                cell,
                (self.get(F::SoilDepth, cell)? - soil).max(0.0),
            )?;
            self.record_flow(
                cause,
                Pool::Loose,
                to,
                self.volume(cell, loose.removed * share),
            );
            self.record_flow(
                cause,
                Pool::Rock,
                to,
                self.volume(cell, rock.removed * share),
            );
            removed += (loose.removed + rock.removed) * share;
        }
        self.project(cell)?;
        Ok(removed)
    }
    fn extract_column(
        &mut self,
        cell: usize,
        column: Column,
        action: &Extraction<'_>,
        context: [f64; 2],
        receive: &mut MaterialReceiver<'_>,
    ) -> io::Result<Extracted> {
        let [skin, area_share] = context;
        let mut layers = Vec::new();
        let last = self.columns.deepest(cell, column)?;
        let (mut top, mut removed, mut soil) = (0.0, 0.0, 0.0);
        for slot in 0..=last {
            let layer = self.columns.read_layer(cell, column, slot)?;
            let taken = extract_parcel(
                &layer,
                action,
                [top, removed, area_share],
                !column.finite() && slot == last,
                receive,
            )?;
            removed += taken.removed;
            if taken.reached > 0.0 {
                soil += taken.removed * taken.reached.min(skin - top).max(0.0) / taken.reached;
            }
            layers.extend(taken.layers);
            top += layer.depth;
        }
        if removed > 0.0 {
            coarsen_package(&mut layers, column.size(), !column.finite(), &mut |fold| {
                self.events.folded(cell, column, &fold)
            })?;
            self.columns.write_column(cell, column, &layers)?;
        }
        Ok(Extracted { removed, soil })
    }
}
