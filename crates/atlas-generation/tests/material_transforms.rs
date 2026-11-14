use atlas_generation::rock::{catalogue::*, transforms::*};

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn burial_cements_loose_constituents_without_replacing_intact_clasts() {
    let mut input = material(ALLUVIUM, 30.0, 4.0);
    input.secondary_kind = 10; // granite clasts
    input.secondary_share = 0.25;
    input.strength = 825.0;
    input.damage = 0.8;
    input.bed_slope_x = -0.3;
    let buried = burial_response(&input, 8.0);
    assert_eq!((buried.kind, buried.secondary_kind), (SANDSTONE, 10));
    assert_eq!(buried.strength, 1425.0);
    assert_eq!(buried.consolidation, 0.65);
    assert_eq!(buried.damage, 0.4);
    assert_eq!(buried.formed_min, 4.0);
    assert_eq!(buried.bed_slope_x, -0.3);
    assert_eq!(buried.altered, 8.0);
    assert_eq!(input.kind, ALLUVIUM);
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn heat_transforms_each_constituent_and_leaves_unaffected_material_unchanged() {
    let mut input = material(1, 20.0, 2.0); // shale and limestone
    input.secondary_kind = 3;
    input.secondary_share = 0.25;
    input.damage = 0.6;
    let heated = heated_material(&input, 7.0);
    assert_eq!((heated.kind, heated.secondary_kind), (5, 7));
    assert_eq!(heated.strength, 1375.0);
    assert_eq!(heated.damage, 0.3);
    assert_eq!(heated.consolidation, 1.0);
    let granite = material(10, 50.0, 2.0);
    assert_eq!(heated_material(&granite, 7.0), granite);
}
