use atlas_generation::rock::*;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

fn facts(solubility: f64) -> MaterialFacts {
    MaterialFacts {
        resistance: 1000.0,
        jointing: 0.3,
        bedding: 0.8,
        solubility,
        porosity: 0.5,
        gives: [None; 4],
    }
}
fn bed(kind: usize) -> MaterialResponse {
    MaterialResponse {
        kind,
        secondary_kind: kind,
        secondary_share: 0.0,
        strength: 1000.0,
        consolidation: 1.0,
        damage: 0.0,
        grain: [0.0, 0.0],
        bed_slope: [0.0, 0.0],
    }
}

#[test]
fn solution_answers_composition_while_abrasion_answers_retained_strength() {
    let kinds = [facts(0.8), facts(0.1)];
    let solution = compile_mix(
        &kinds,
        ModeMix::default().with(ModeId::Solution, 1.0),
        1000.0,
        300.0,
    );
    let abrasion = compile_mix(
        &kinds,
        ModeMix::default().with(ModeId::Abrasion, 1.0),
        1000.0,
        300.0,
    );
    let mut layer = bed(0);
    layer.strength = 2000.0;
    assert_eq!(material_gives(&solution, &layer, false, [0.0, 0.0]), 0.8);
    assert_eq!(material_gives(&abrasion, &layer, false, [0.0, 0.0]), 0.5);
    layer.secondary_kind = 1;
    layer.secondary_share = 0.5;
    assert!((material_gives(&solution, &layer, false, [0.0, 0.0]) - 0.45).abs() < 1e-12);
}

#[test]
fn material_exceptions_and_signed_bedding_remain_in_the_interaction() {
    let mut kept = facts(0.5);
    kept.gives[ModeId::Abrasion as usize] = Some(0.1);
    let abrasion = compile_mix(
        &[kept],
        ModeMix::default().with(ModeId::Abrasion, 1.0),
        1000.0,
        300.0,
    );
    let mut layer = bed(0);
    layer.strength = 2000.0;
    assert_eq!(material_gives(&abrasion, &layer, false, [0.0, 0.0]), 0.1);
    let shear = compile_mix(
        &[facts(0.0)],
        ModeMix::default().with(ModeId::Shear, 1.0),
        1000.0,
        300.0,
    );
    layer.bed_slope = [1.0, 0.0];
    assert!(
        material_gives(&shear, &layer, false, [-1.0, 0.0])
            > material_gives(&shear, &layer, false, [1.0, 0.0])
    );
}
