use super::super::{Input, Process, Registry, Specification};
use crate::{
    atlas::{
        native::NativeSteps,
        regional::{
            begin,
            queries::Reads,
            work::{Occurrence, Work},
        },
    },
    execution::ExecutionResult,
    products::ProductContract,
};
use std::io;
fn begin_specification() -> Specification {
    Specification::new("refinement.begin", "atlas:workspace", "", true)
}

pub fn initialize(
    registry: &mut Registry,
    capture: begin::Capture,
    magic: Option<crate::execution::Command<crate::atlas::state::State>>,
) -> io::Result<()> {
    registry.register(Process::unit(
        begin_specification(),
        begin::operation(capture, magic),
    ))
}

fn specification(name: &str, products: Vec<String>, workspace: bool) -> io::Result<Specification> {
    let mut spec = Specification::new(
        &format!("refinement.{name}"),
        "atlas:workspace",
        "",
        workspace,
    );
    spec.contract.produces = products;
    spec.parameters = serde_json::from_value(serde_json::json!({
        "round":{"type":"number","unit":null,"required":false,"default":0},
        "people":{"type":"boolean","unit":null,"required":false,"default":false}
    }))?;
    Ok(spec)
}
fn occurrence(input: &Input) -> ExecutionResult<Occurrence> {
    let round = input.number("round")?;
    if !round.is_finite() || round < 0.0 || round.fract() != 0.0 || round > usize::MAX as f64 {
        return Err(io::Error::other("Regional round must be a nonnegative integer").into());
    }
    Ok(Occurrence {
        physical: input.physical.context,
        round: round as usize,
        people: input.flag("people")?,
    })
}
fn routing(native: &[ProductContract]) -> io::Result<Vec<String>> {
    let mut products = Vec::new();
    for name in [
        "drainage-conditioning",
        "lake-basins",
        "drainage-guidance",
        "flow-routing",
        "river-network",
    ] {
        for product in &native_contract(native, name)?.produces {
            if !products.contains(product) {
                products.push(product.clone());
            }
        }
    }
    Ok(products)
}
fn native_contract<'a>(
    native: &'a [ProductContract],
    name: &str,
) -> io::Result<&'a ProductContract> {
    native
        .iter()
        .find(|contract| contract.id == format!("atlas.{name}"))
        .ok_or_else(|| io::Error::other(format!("Unknown native process {name}")))
}
fn query_products(name: &str, native: &[ProductContract]) -> io::Result<Vec<String>> {
    Ok(match name {
        "ocean" => native_contract(native, "ocean-connectivity")?
            .produces
            .clone(),
        "climate" => "Temperature Rainfall Snowfall Moisture WindX WindY Seasonality AirDemand"
            .split_whitespace()
            .map(|s| format!("field:{s}"))
            .collect(),
        "water" => routing(native)?,
        "refresh" => vec!["atlas:validated".into()],
        _ => Vec::new(),
    })
}
fn command_products(name: &str, native: &[ProductContract]) -> io::Result<Vec<String>> {
    if matches!(name, "water-initialize" | "water-evolution") {
        routing(native)
    } else {
        Ok(Vec::new())
    }
}
type QuerySelect = fn(&Reads) -> &crate::execution::Query<crate::atlas::state::State, ()>;
const QUERIES: &[(&str, QuerySelect)] = &[
    ("ocean", |r| &r.ocean),
    ("media", |r| &r.media),
    ("magic-refresh", |r| &r.magic),
    ("climate", |r| &r.climate),
    ("water", |r| &r.water),
    ("ecology-present", |r| &r.habitats),
    ("landforms", |r| &r.landforms),
    ("refresh", |r| &r.refresh),
];
type CommandSelect = fn(&Work) -> &crate::atlas::regional::work::Operation;
const COMMANDS: &[(&str, CommandSelect, bool)] = &[
    ("clear-products", |w| &w.clear, false),
    ("context", |w| &w.context, true),
    ("round", |w| &w.round, true),
    ("relief", |w| &w.relief, true),
    ("water-initialize", |w| &w.water_initialize, true),
    ("water-evolution", |w| &w.water_evolution, true),
    ("ocean-memory", |w| &w.ocean_memory, true),
    ("magic-react", |w| &w.magic_react, true),
    ("magic-transport", |w| &w.magic_transport, true),
    ("magic-water", |w| &w.magic_water, true),
    ("magic-organic", |w| &w.magic_organic, true),
    ("ecology-initialize", |w| &w.ecology_initialize, true),
    ("ecology-develop", |w| &w.ecology_develop, true),
    ("place-effects", |w| &w.place_effects, true),
    ("magic-map", |w| &w.magic_map, false),
    ("identity", |w| &w.identity, false),
    ("places", |w| &w.places, false),
];
pub fn specifications(native: &[ProductContract]) -> io::Result<Vec<Specification>> {
    let mut result = vec![begin_specification()];
    for (name, _) in QUERIES {
        result.push(specification(name, query_products(name, native)?, true)?);
    }
    for &(name, _, workspace) in COMMANDS {
        result.push(specification(
            name,
            command_products(name, native)?,
            workspace,
        )?);
    }
    Ok(result)
}
pub fn register(
    registry: &mut Registry,
    reads: &Reads,
    work: &Work,
    native: &NativeSteps,
) -> ExecutionResult<()> {
    let native = native
        .definitions()
        .iter()
        .map(|step| step.contract.clone())
        .collect::<Vec<_>>();
    for (name, query) in QUERIES {
        registry.register(Process::query(
            specification(name, query_products(name, &native)?, true)?,
            query(reads).clone(),
        ))?;
    }
    for &(name, command, workspace) in COMMANDS {
        registry.register(Process::command(
            specification(name, command_products(name, &native)?, workspace)?,
            command(work).clone(),
            occurrence,
        ))?;
    }
    Ok(())
}
