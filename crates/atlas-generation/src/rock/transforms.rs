//! Constituent-preserving burial and heating from rock/modes.ts.
use super::{
    catalogue::{kind_of_code, RockFamily, CATALOGUE, SANDSTONE},
    material::MaterialLayer,
};

pub fn burial_response(layer: &MaterialLayer, epoch: f64) -> MaterialLayer {
    let consolidate = |code| {
        let kind = kind_of_code(code);
        if kind.family == RockFamily::Loose {
            &CATALOGUE[SANDSTONE]
        } else {
            kind
        }
    };
    let first = consolidate(layer.kind);
    let second = consolidate(layer.secondary_kind);
    MaterialLayer {
        kind: first.code,
        secondary_kind: second.code,
        strength: (layer.strength
            + (first.facts.resistance - kind_of_code(layer.kind).facts.resistance)
                * (1.0 - layer.secondary_share)
            + (second.facts.resistance - kind_of_code(layer.secondary_kind).facts.resistance)
                * layer.secondary_share)
            .max(0.0),
        damage: layer.damage * 0.5,
        consolidation: 0.65,
        altered: epoch,
        ..layer.clone()
    }
}
pub fn heated_material(layer: &MaterialLayer, epoch: f64) -> MaterialLayer {
    let heat = |code| {
        let kind = kind_of_code(code);
        kind.under_heat.map(kind_of_code).unwrap_or(kind)
    };
    let first = heat(layer.kind);
    let second = heat(layer.secondary_kind);
    if first.code == layer.kind && second.code == layer.secondary_kind {
        return layer.clone();
    }
    MaterialLayer {
        kind: first.code,
        secondary_kind: second.code,
        strength: first.facts.resistance * (1.0 - layer.secondary_share)
            + second.facts.resistance * layer.secondary_share,
        damage: layer.damage * 0.5,
        consolidation: 1.0,
        altered: epoch,
        ..layer.clone()
    }
}
