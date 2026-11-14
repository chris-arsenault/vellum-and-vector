//! Selective material removal retains unreached beds and their cargo.
use super::{cargo::MaterialCargo, material::MaterialLayer};
pub struct ConstituentRemoval {
    pub removed: f64,
    pub remaining: MaterialLayer,
    pub cargo: Option<MaterialCargo>,
}
pub fn extract_constituent(
    layer: &MaterialLayer,
    kind: usize,
    requested: f64,
) -> ConstituentRemoval {
    let primary = if layer.kind == kind {
        1.0 - layer.secondary_share
    } else {
        0.0
    };
    let secondary = if layer.secondary_kind == kind {
        layer.secondary_share
    } else {
        0.0
    };
    let share = primary + secondary;
    let removed = requested.max(0.0).min(layer.depth * share);
    if removed <= 0.0 {
        return ConstituentRemoval {
            removed: 0.0,
            remaining: layer.clone(),
            cargo: None,
        };
    }
    let depth = layer.depth - removed;
    let cargo = layer
        .cargo
        .as_ref()
        .map(|cargo| cargo.partition(kind as i32, share, removed / layer.depth));
    let a = layer.depth * (1.0 - layer.secondary_share) - removed * primary / share;
    let b = layer.depth * layer.secondary_share - removed * secondary / share;
    let remaining = MaterialLayer {
        depth,
        kind: if a > 0.0 {
            layer.kind
        } else {
            layer.secondary_kind
        },
        secondary_share: if a > 0.0 && depth > 0.0 {
            b / depth
        } else {
            0.0
        },
        cargo: cargo.as_ref().and_then(|parts| parts.remaining.clone()),
        ..layer.clone()
    };
    ConstituentRemoval {
        removed,
        remaining,
        cargo: cargo.and_then(|parts| parts.taken),
    }
}
pub fn extractable_depth(layer: &MaterialLayer, basement: bool) -> f64 {
    (layer.depth - f64::from(basement)).max(0.0)
}
pub struct ReachedRemoval {
    pub removed: f64,
    pub layers: Vec<MaterialLayer>,
    pub reached: f64,
    pub cargo: Option<MaterialCargo>,
}
pub fn extract_reached(
    layer: &MaterialLayer,
    kind: usize,
    amount: f64,
    reach: f64,
    basement: bool,
) -> ReachedRemoval {
    let reached = reach.min(extractable_depth(layer, basement)).max(0.0);
    let taken = extract_constituent(
        &MaterialLayer {
            depth: reached,
            ..layer.clone()
        },
        kind,
        amount,
    );
    if taken.removed <= 0.0 {
        return ReachedRemoval {
            removed: 0.0,
            layers: vec![layer.clone()],
            reached,
            cargo: None,
        };
    }
    let mut layers = Vec::new();
    if taken.remaining.depth > 0.0 {
        layers.push(taken.remaining);
    }
    if layer.depth > reached {
        layers.push(MaterialLayer {
            depth: layer.depth - reached,
            ..layer.clone()
        });
    }
    ReachedRemoval {
        removed: taken.removed,
        layers,
        reached,
        cargo: taken.cargo,
    }
}
pub type SelectKinds<'a> = dyn Fn(&MaterialLayer) -> Vec<usize> + 'a;
pub type SelectAmount<'a> = dyn Fn(&MaterialLayer, f64, usize) -> f64 + 'a;
pub enum ExtractionKind<'a> {
    One(usize),
    Selected(&'a SelectKinds<'a>),
}
pub struct Extraction<'a> {
    pub kind: ExtractionKind<'a>,
    pub amount: f64,
    pub reach: f64,
    pub surface_only: bool,
    pub loose_only: bool,
    pub select: Option<&'a SelectAmount<'a>>,
}
impl Extraction<'_> {
    pub fn with_extent(&self, amount: f64, reach: f64) -> Extraction<'_> {
        Extraction {
            kind: match &self.kind {
                ExtractionKind::One(kind) => ExtractionKind::One(*kind),
                ExtractionKind::Selected(select) => ExtractionKind::Selected(*select),
            },
            amount,
            reach,
            surface_only: self.surface_only,
            loose_only: self.loose_only,
            select: self.select,
        }
    }
}
pub(super) struct ParcelRemoval {
    pub removed: f64,
    pub layers: Vec<MaterialLayer>,
    pub reached: f64,
}
pub(super) fn extract_parcel(
    layer: &MaterialLayer,
    action: &Extraction<'_>,
    interval: [f64; 3],
    basement: bool,
    receive: &mut dyn FnMut(MaterialLayer) -> std::io::Result<()>,
) -> std::io::Result<ParcelRemoval> {
    let [top, before, area_share] = interval;
    let reached = (action.reach - top)
        .min(extractable_depth(layer, basement))
        .max(0.0);
    let kinds = match &action.kind {
        ExtractionKind::One(kind) => vec![*kind],
        ExtractionKind::Selected(select) => select(layer),
    };
    let mut current = MaterialLayer {
        depth: reached,
        ..layer.clone()
    };
    let mut removed = 0.0;
    for kind in kinds {
        let selected = action
            .select
            .map_or(f64::INFINITY, |select| select(&current, area_share, kind));
        let taken = extract_constituent(
            &current,
            kind,
            (action.amount - before - removed).min(selected),
        );
        if taken.removed <= 0.0 {
            continue;
        }
        receive(MaterialLayer {
            kind,
            secondary_kind: kind,
            secondary_share: 0.0,
            depth: taken.removed,
            cargo: taken.cargo,
            ..current
        })?;
        removed += taken.removed;
        current = taken.remaining;
    }
    let mut layers = Vec::new();
    if removed <= 0.0 {
        layers.push(layer.clone());
    } else {
        if current.depth > 0.0 {
            layers.push(current);
        }
        if layer.depth > reached {
            layers.push(MaterialLayer {
                depth: layer.depth - reached,
                ..layer.clone()
            });
        }
    }
    Ok(ParcelRemoval {
        removed,
        layers,
        reached,
    })
}
