use super::{
    alteration::Alteration,
    inventory::{cargo_density, InventoryKey},
    placement::cover_column,
    Ground, MaterialReceiver,
};
use crate::{
    rock::{
        cargo::{CargoMixture, MaterialCargo},
        catalogue::material,
        columns::Column,
        extraction::{Extraction, ExtractionKind},
        material::MaterialLayer,
    },
    scale::{LengthUnit, MapScale},
    settlement::{removal::Facet, stage::Pool},
};
use std::{cell::Cell, io};
pub struct Charge<'a> {
    pub amount: f64,
    pub reach: f64,
    pub hosts: &'a [usize],
    pub from_rock: bool,
    pub start: f64,
}
pub struct InventoryAccess {
    pub reach: f64,
    pub surface_only: bool,
    pub loose_only: bool,
}
pub struct InventoryConstruction {
    pub amount: f64,
    pub depth: f64,
    pub kind: usize,
}
impl Ground {
    pub fn inventory_release(
        &mut self,
        key: InventoryKey,
        cell: usize,
        reach: f64,
        fraction: &dyn Fn(&MaterialLayer) -> f64,
    ) -> io::Result<f64> {
        if !self.columns.has_cargo(cell)? {
            return Ok(0.0);
        }
        let released = Cell::new(0.0);
        for facet in Facet::ALL {
            let area = self.mesh.area(cell) * self.share(cell, facet)?;
            if area <= 0.0 {
                continue;
            }
            let transform = |layer: &MaterialLayer| {
                if cargo_density(layer, key, None) <= 0.0 {
                    return None;
                }
                let share = fraction(layer).clamp(0.0, 1.0);
                if share <= 0.0 {
                    return None;
                }
                let cargo = layer.cargo.as_ref()?;
                let parcel_volume = MapScale::metres(layer.depth, LengthUnit::Native) * area;
                let cargo =
                    MaterialCargo::from_entries(cargo.entries().map(|(held, host, density)| {
                        if held != key.0 {
                            return (held, host, density);
                        }
                        released.set(released.get() + density * share * parcel_volume);
                        (held, host, density * (1.0 - share))
                    }));
                Some(MaterialLayer {
                    cargo: Some(cargo),
                    ..layer.clone()
                })
            };
            self.alter(
                cell,
                &Alteration {
                    depth: reach,
                    offset: 0.0,
                    from_rock: false,
                    retained_only: true,
                    transform: &transform,
                    facet: Some(facet),
                },
            )?;
        }
        Ok(released.get())
    }
    pub fn inventory_construct(
        &mut self,
        key: InventoryKey,
        cell: usize,
        body: InventoryConstruction,
        cause: &str,
    ) -> io::Result<()> {
        if body.amount <= 0.0 || body.depth <= 0.0 {
            return Ok(());
        }
        let density = body.amount / self.volume(cell, body.depth);
        let mut body = material(body.kind, body.depth, self.epoch);
        body.cargo = Some(MaterialCargo::from_entries([(
            key.0,
            body.kind as i32,
            density,
        )]));
        self.construct_material(cell, &body, cause, Pool::Space, None)?;
        Ok(())
    }
    pub fn inventory_charge(
        &mut self,
        key: InventoryKey,
        cell: usize,
        action: &Charge<'_>,
    ) -> io::Result<f64> {
        let area = self.mesh.area(cell);
        let mut volume = 0.0;
        self.visit_inventory(cell, &mut |layer| {
            if action.from_rock && layer.column.finite() {
                return Ok(());
            }
            let offset = if action.from_rock {
                let facet = if layer.column == Column::Land {
                    Facet::Land
                } else {
                    Facet::Cut
                };
                self.columns.thickness(cell, cover_column(facet))?
            } else {
                0.0
            };
            if action.hosts.contains(&layer.material.kind) {
                let top = layer.top - offset;
                let depth = ((top + layer.material.depth).min(action.start + action.reach)
                    - top.max(action.start))
                .max(0.0);
                volume += MapScale::metres(depth, LengthUnit::Native) * area * layer.share;
            }
            Ok(())
        })?;
        if volume <= 0.0 || action.amount <= 0.0 {
            return Ok(0.0);
        }
        let transform = |layer: &MaterialLayer| {
            if !action.hosts.contains(&layer.kind) {
                return None;
            }
            let mut cargo = CargoMixture::default();
            cargo.add(layer.cargo.as_ref(), 1.0);
            cargo.add_entry(key.0, layer.kind as i32, action.amount / volume);
            Some(MaterialLayer {
                cargo: cargo.finish(1.0),
                ..layer.clone()
            })
        };
        self.alter(
            cell,
            &Alteration {
                depth: action.reach,
                offset: action.start,
                from_rock: action.from_rock,
                retained_only: true,
                transform: &transform,
                facet: None,
            },
        )?;
        Ok(action.amount)
    }
    /// The receiver gets material depth weighted by the source facet; its charge follows that parcel.
    pub fn inventory_extract(
        &mut self,
        key: InventoryKey,
        cell: usize,
        amount: f64,
        access: &InventoryAccess,
        receive: &mut MaterialReceiver<'_>,
    ) -> io::Result<f64> {
        let remaining = Cell::new(amount);
        let area = self.mesh.area(cell);
        let kinds = |layer: &MaterialLayer| {
            let mut kinds = Vec::new();
            for kind in [layer.kind, layer.secondary_kind] {
                if !kinds.contains(&kind)
                    && (cargo_density(layer, key, Some(kind)) > 0.0
                        || cargo_density(layer, key, Some(0)) > 0.0)
                {
                    kinds.push(kind);
                }
            }
            kinds
        };
        let select = |layer: &MaterialLayer, area_share: f64, kind| {
            let share = if layer.kind == kind {
                1.0 - layer.secondary_share
            } else {
                0.0
            } + if layer.secondary_kind == kind {
                layer.secondary_share
            } else {
                0.0
            };
            let density =
                cargo_density(layer, key, Some(kind)) + cargo_density(layer, key, Some(0)) * share;
            if density > 0.0 {
                MapScale::native((remaining.get().max(0.0) * share) / (density * area * area_share))
            } else {
                0.0
            }
        };
        self.extract(
            cell,
            &Extraction {
                kind: ExtractionKind::Selected(&kinds),
                amount: f64::INFINITY,
                reach: access.reach,
                surface_only: access.surface_only,
                loose_only: access.loose_only,
                select: Some(&select),
            },
            "magic extraction",
            Pool::Load,
            &mut |parcel| {
                remaining.set(
                    remaining.get()
                        - cargo_density(&parcel, key, None)
                            * MapScale::metres(parcel.depth, LengthUnit::Native)
                            * area,
                );
                receive(parcel)
            },
        )?;
        Ok(amount - remaining.get())
    }
}
