use atlas_generation::{field::shared::CellCode, transport::quantities::*};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

#[test]
fn rifts_blend_shares_but_amounts_keep_only_the_arriving_amount() {
    assert_eq!(
        arrived(QuantityKind::Share, 40.0 * 250_000.0, 250_000.0, 2, 20.0),
        25.0
    );
    assert_eq!(
        arrived(QuantityKind::Share, 40.0 * 250_000.0, 250_000.0, 0, 20.0),
        40.0
    );
    assert_eq!(
        arrived(QuantityKind::Amount, 40.0 * 250_000.0, 250_000.0, 2, 20.0),
        10.0
    );
    assert_eq!(arrived(QuantityKind::Share, 0.0, 0.0, 2, 20.0), 20.0);
    assert_eq!(arrived(QuantityKind::Amount, 0.0, 0.0, 2, 20.0), 0.0);
}
#[test]
fn identities_use_weighted_donors_thresholds_and_substrate_retention() {
    let assembly = CellCode::CrustAssemblyIds.identity_rule().unwrap();
    let mut choice = IdentityChoice {
        value: 0,
        held: 0.0,
    };
    choice.offer(&assembly, 7, 200_000.0, 1000.0);
    choice.offer(&assembly, 5, 800_000.0, 250.0);
    choice.offer(&assembly, 3, 1_000_000.0, 0.0);
    assert_eq!(choice.value, 5);
    assert_eq!(choice.settle(&assembly, false, 0), 0);
    let latest = CellCode::VolcanicLastActiveEpoch.identity_rule().unwrap();
    let mut choice = IdentityChoice {
        value: -1,
        held: 0.0,
    };
    choice.offer(&latest, 12, 49_999.0, 1.0);
    choice.offer(&latest, 8, 50_000.0, 1.0);
    choice.offer(&latest, 6, 1_000_000.0, 1.0);
    assert_eq!(choice.value, 8);
    let flags = CellCode::FeatureFlags.identity_rule().unwrap();
    let mut choice = IdentityChoice {
        value: 0,
        held: 0.0,
    };
    choice.offer(&flags, (1 << 8) | 2, 50_000.0, 1.0);
    choice.offer(&flags, 4, 100_000.0, 1.0);
    assert_eq!(choice.settle(&flags, false, 0), 6);
}
