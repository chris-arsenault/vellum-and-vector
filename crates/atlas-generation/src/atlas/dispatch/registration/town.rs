use super::super::{Input, Process, Registry, Specification};
use crate::{
    atlas::town::{self, story::Layout, Settings},
    execution::ExecutionResult,
    town::{major_works::WorkFamily, templates::Template},
};
use std::io;

/// The creator's one choice is the layout; the process's layout controls are declared once in
/// `atlas/town/settings.rs`.
pub fn specification() -> io::Result<Specification> {
    let mut spec = Specification::new("real-scale.settlement", "atlas:workspace", "", false);
    spec.parameters = serde_json::from_value(serde_json::json!({
        "layout": {"type":"enum","unit":null,"required":false,"default":"story","choices":town::LAYOUTS}
    }))?;
    Ok(spec)
}
fn settings(input: &Input) -> ExecutionResult<Settings> {
    Ok(Settings {
        seed: (input.random.borrow_mut().sample(true) * f64::from(i32::MAX)) as i32,
        layout: input
            .parameters
            .get("layout")
            .and_then(serde_json::Value::as_str)
            .and_then(Layout::parse),
        template: input
            .parameters
            .get(town::TEMPLATE)
            .and_then(serde_json::Value::as_str)
            .and_then(Template::from_name),
        major_work: input
            .parameters
            .get(town::MAJOR_WORK)
            .and_then(serde_json::Value::as_str)
            .and_then(WorkFamily::from_key),
    })
}
fn initialization() -> io::Result<Specification> {
    let mut spec = specification()?;
    spec.contract.id = "town.initialize".into();
    spec.parameters.extend(serde_json::from_value::<crate::parameters::Definitions>(serde_json::json!({
        (town::TEMPLATE): {"type":"enum","required":false,"choices":Template::ALL.map(Template::name)},
        (town::MAJOR_WORK): {"type":"enum","required":false,"choices":WorkFamily::ALL.iter().map(|family| family.key()).collect::<Vec<_>>()}
    }))?);
    Ok(spec)
}
pub fn specifications() -> io::Result<Vec<Specification>> {
    let mut result = vec![specification()?];
    result.push(initialization()?);
    result.extend(
        crate::processes::town::STEPS
            .iter()
            .filter(|s| !crate::processes::town::urban::registration::owns(s.id))
            .map(|s| Specification::new(s.id, "atlas:workspace", "", true)),
    );
    result.push(Specification::new(
        "town.signals",
        "atlas:workspace",
        "",
        true,
    ));
    result.push(Specification::new(
        "town.cultivation",
        "atlas:workspace",
        "",
        true,
    ));
    result.push(crate::processes::town::urban::registration::publication_specification());
    Ok(result)
}
pub fn register(
    registry: &mut Registry,
    operations: &town::development::Operations,
    district_catchment_scale: f64,
) -> io::Result<()> {
    registry.register(Process::unit(
        Specification::new("town.cultivation", "atlas:workspace", "", true),
        town::cultivation(),
    ))?;
    let legacy_initial = operations.initialize.clone();
    let initialize =
        crate::execution::Command::<crate::atlas::state::State, (Settings, bool)>::with_inputs(
            "town.initialize",
            crate::execution::CommandKind::Work,
            vec![],
            move |scope, (input, inherit): &(Settings, bool)| {
                if *inherit {
                    crate::atlas::regional::city::inherit_policy(
                        scope.state_mut(),
                        input.seed,
                        input.template,
                    )?;
                } else if !crate::processes::town::urban::capture_street(scope.state_mut())? {
                    scope.run(&legacy_initial, input)?;
                }
                Ok(())
            },
        );
    registry.register(Process::command(initialization()?, initialize, |input| {
        use crate::processes::strategies::{at, definitions, Kind, MapType, Timing};
        let inherited = input.site.map_type == MapType::City
            && at(definitions("town.initialize")?, input.site, Timing::Present)?
                .iter()
                .any(|row| row.kind == Kind::Inherited && row.id == "city-template-policy");
        Ok((settings(input)?, inherited))
    }))?;
    for (id, operation) in &operations.steps {
        if crate::processes::town::urban::registration::owns(id) {
            continue;
        }
        registry.register(Process::unit(
            Specification::new(id, "atlas:workspace", "", true),
            operation.clone(),
        ))?;
    }
    crate::processes::town::urban::registration::register(
        registry,
        Some(operations),
        district_catchment_scale,
    )?;
    registry.register(Process::command(
        specification()?,
        town::operation(),
        settings,
    ))
}
