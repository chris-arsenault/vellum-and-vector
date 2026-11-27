use super::super::{Input, Process, Registry, Specification};
use crate::{
    atlas::{
        state::State,
        town::{self, story::Layout, Settings},
    },
    execution::{Command, CommandKind, ExecutionResult},
    town::{
        major_works::WorkFamily,
        templates::{civic::Civic, Template},
    },
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
        order: crate::town::order::Order::from_input(input)?,
        civic: input
            .parameters
            .get(town::CIVIC_ORDER)
            .and_then(serde_json::Value::as_str)
            .and_then(Civic::from_name),
    })
}
fn initialization() -> io::Result<Specification> {
    let mut spec = specification()?;
    spec.contract.id = "town.initialize".into();
    spec.parameters.extend(serde_json::from_value::<crate::parameters::Definitions>(serde_json::json!({
        (town::TEMPLATE): {"type":"enum","required":false,"choices":Template::ALL.map(Template::name)},
        (town::MAJOR_WORK): {"type":"enum","required":false,"choices":WorkFamily::ALL.iter().map(|family| family.key()).collect::<Vec<_>>()},
        (town::CIVIC_ORDER): {"type":"enum","required":false,"choices":Civic::ALL.map(Civic::name)}
    }))?);
    Ok(spec.numeric(crate::town::order::CONTROLS))
}
pub fn specifications() -> io::Result<Vec<Specification>> {
    let mut result = vec![specification()?.publication()];
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
    result.push(crate::processes::town::cultivation::owner().specification());
    result.push(crate::processes::town::urban::registration::publication_specification());
    Ok(result)
}
pub fn register(
    registry: &mut Registry,
    operations: &town::development::Operations,
) -> io::Result<()> {
    crate::processes::town::cultivation::register(registry)?;
    let found = operations.initialize.clone();
    let initialize = crate::execution::Command::<
        crate::atlas::state::State,
        (Settings, Option<&'static str>, bool),
    >::with_inputs(
        "town.initialize",
        crate::execution::CommandKind::Work,
        vec![],
        move |scope, (input, policy, districts): &(Settings, Option<&str>, bool)| {
            if *policy == Some("city-template-policy") {
                crate::atlas::regional::city::inherit_policy(
                    scope.state_mut(),
                    input.seed,
                    (input.template, input.civic),
                )?;
            } else if *policy == Some("street-founding-policy") {
                if *districts {
                    crate::processes::town::urban::capture_street(scope.state_mut())?;
                }
                scope.run(&found, &(*input, town::development::STREET_FOUNDING))?;
            }
            Ok(())
        },
    );
    registry.register(Process::command(initialization()?, initialize, |input| {
        use crate::processes::strategies::{at, definitions, Kind, MapType, Timing};
        let street = input.site.map_type == MapType::Street;
        let policy = if street {
            let strategy = town::development::STREET_FOUNDING;
            super::street_strategy(input, "town.initialize", strategy.name)?
                .then_some(strategy.name)
        } else {
            at(definitions("town.initialize")?, input.site, Timing::Present)?
                .into_iter()
                .find(|row| row.kind == Kind::Inherited)
                .map(|row| row.id.as_str())
        };
        let districts = super::street_strategy(input, "town.districts", "inherit-districts")?;
        Ok((settings(input)?, policy, districts))
    }))?;
    register_street_work(
        registry,
        "town.signals",
        "local-pressure-readout",
        operations.pressure.clone(),
    )?;
    for (id, operation) in &operations.steps {
        if crate::processes::town::urban::registration::owns(id) {
            continue;
        }
        registry.register(Process::command(
            Specification::new(id, "atlas:workspace", "", true),
            operation.clone(),
            |_| Ok(crate::processes::town::urban::registration::LocalInputs::TOWN),
        ))?;
    }
    crate::processes::town::urban::registration::register(registry, Some(operations))?;
    registry.register(Process::publication_command(
        specification()?,
        super::super::publication::settlement(),
    ))
}

fn register_street_work(
    registry: &mut Registry,
    id: &'static str,
    strategy: &'static str,
    operation: Command<State>,
) -> io::Result<()> {
    let run = Command::with_inputs(
        id,
        CommandKind::Work,
        vec![],
        move |scope, selected: &bool| {
            if *selected {
                scope.run(&operation, &())?;
            }
            Ok(())
        },
    );
    registry.register(Process::command(
        Specification::new(id, "atlas:workspace", "", true),
        run,
        move |input| Ok(super::street_strategy(input, id, strategy)?),
    ))
}
