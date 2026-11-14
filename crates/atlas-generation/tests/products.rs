use atlas_generation::products::*;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

fn contract(id: &str) -> ProductContract {
    ProductContract {
        id: id.into(),
        version: "1".into(),
        requires: vec!["material".into()],
        produces: vec!["response".into()],
        invalidates: vec![],
    }
}
#[test]
fn epoch_responses_expire_while_carried_material_remains_available() {
    let mut ledger = ProductLedger::new(
        ["material".into()],
        [
            ProductDefinition::new("response", Lifetime::Epoch),
            ProductDefinition::new("material", Lifetime::Run),
        ],
    )
    .unwrap();
    assert_eq!(ledger.status("response"), ProductStatus::Missing);
    assert_eq!(ledger.missing(&contract("supplied")), Vec::<&str>::new());
    ledger.produce("response");
    assert_eq!(ledger.status("response"), ProductStatus::Available);
    ledger.enter_epoch("next");
    assert_eq!(ledger.status("response"), ProductStatus::Stale);
    assert_eq!(
        ledger.invalidated_by("response"),
        Some("next epoch boundary")
    );
    assert!(ledger.accepts("material"));
}
#[test]
fn exclusive_provider_checks_precede_commits_and_shared_writers_remain_usable() {
    let mut definition = ProductDefinition::new("response", Lifetime::Run);
    definition.composition = Some(Composition::Exclusive);
    let mut ledger = ProductLedger::new([], [definition.clone()]).unwrap();
    ledger.commit(&contract("first"), "first pass").unwrap();
    ledger.commit(&contract("first"), "next pass").unwrap();
    assert!(matches!(
        ledger.check_providers(&contract("second")),
        Err(ProductError::ExclusiveProviders { .. })
    ));
    definition.composition = Some(Composition::SharedState);
    let mut shared = ProductLedger::new([], [definition]).unwrap();
    shared.commit(&contract("first"), "first").unwrap();
    shared.commit(&contract("second"), "second").unwrap();
}
#[test]
fn conditional_repair_join_requires_validity_on_both_outcomes() {
    let mut ledger = ProductLedger::new(["terrain".into(), "routing".into()], []).unwrap();
    let mut branch = ledger.clone();
    branch.invalidate("routing", "changed terrain");
    branch.produce("new forcing");
    ledger.join(&branch, "conditional repair");
    assert!(ledger.accepts("terrain"));
    assert_eq!(ledger.status("routing"), ProductStatus::Stale);
    assert_eq!(ledger.status("new forcing"), ProductStatus::Stale);
    branch.produce("routing");
    ledger.produce("routing");
    ledger.join(&branch, "both repaired");
    assert!(ledger.accepts("routing"));
}
#[test]
fn conflicting_declarations_do_not_silently_change_a_product_lifetime_or_units() {
    let mut first = ProductDefinition::new("response", Lifetime::Run);
    first.unit = Some("metre".into());
    let mut second = first.clone();
    second.unit = Some("second".into());
    assert!(matches!(
        ProductLedger::new([], [first, second]),
        Err(ProductError::ConflictingDefinition(_))
    ));
}
