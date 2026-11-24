//! Print the flat review view generated from the canonical strategy catalog.
fn main() {
    println!(
        "{}",
        include_str!(concat!(env!("OUT_DIR"), "/process-applicability.json"))
    );
}
