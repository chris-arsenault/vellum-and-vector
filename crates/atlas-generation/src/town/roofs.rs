//! Building components leave working yards and passages in the holding's own frame.
use super::{
    catalogue::{Form, Kind, PlaceRules},
    fabric::polygon,
    geometry::{add, rectangle, scale},
    plots::Slot,
};
use atlas_map::Geometry;
pub fn components(slot: &Slot, kind: Kind, means: f64, sample: f64) -> Vec<Geometry> {
    if kind.open() {
        return vec![];
    }
    let form = kind.definition().form;
    let width = slot.frontage * (0.7 + means * 0.2);
    let depth = slot.depth;
    let roof = |across: f64, back: f64, w: f64, d: f64| {
        polygon(&rectangle(
            add(
                add(slot.front, scale(slot.direction, across)),
                scale(slot.inward, back),
            ),
            slot.direction,
            slot.inward,
            w,
            d,
        ))
    };
    // owner-direction(2026-11-18): town housing includes multi-storey, connected houses.
    if kind.definition().roles.attached_range {
        let bays = (slot.frontage / 3.8).floor().max(1.) as usize;
        let bay = slot.frontage / bays as f64;
        let mut houses = (0..bays)
            .map(|i| {
                let centre = (i as f64 + 0.5) * bay - slot.frontage / 2.;
                roof(centre, 0.6, bay, (depth * 0.46).min(12.))
            })
            .collect::<Vec<_>>();
        if form == Form::Court {
            houses.push(roof(0., depth * 0.70, width * 0.85, depth * 0.24));
        }
        return houses;
    }
    match form {
        Form::Compound => vec![
            roof(-width * 0.10, depth * 0.48, width * 0.70, depth * 0.32),
            roof(width * 0.33, depth * 0.14, width * 0.23, depth * 0.28),
            roof(-width * 0.32, depth * 0.12, width * 0.25, depth * 0.18),
        ],
        Form::WaterEdge => vec![
            roof(-width * 0.22, 1., width * 0.52, depth * 0.30),
            roof(width * 0.25, depth * 0.52, width * 0.35, depth * 0.26),
        ],
        Form::Court => {
            let wing = width * 0.23;
            // Two front ranges leave an entrance to a common court; side ranges enclose it.
            vec![
                roof(-width * 0.3, 2., width * 0.4, depth * 0.22),
                roof(width * 0.3, 2., width * 0.4, depth * 0.22),
                roof(-width / 2. + wing / 2., depth * 0.3, wing, depth * 0.4),
                roof(width / 2. - wing / 2., depth * 0.3, wing, depth * 0.4),
                roof(0., depth * 0.75, width, depth * 0.18),
            ]
        }
        Form::Yard => {
            let mut buildings = vec![roof(-width * 0.12, 1. + sample, width * 0.68, depth * 0.35)];
            if kind.definition().roles.outbuilding.is_some() || means > 0.5 {
                buildings.push(roof(width * 0.18, depth * 0.7, width * 0.58, depth * 0.22));
            }
            buildings
        }
        _ => vec![roof(
            0.,
            1. + sample * 2.,
            width,
            depth * (0.45 + means * 0.25),
        )],
    }
}
