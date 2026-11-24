//! Recipe validation from preflight.ts. This walks contracts; it never runs simulation work.
use super::{schedule, specifications::Specifications};
use crate::{
    atlas::history::Severity,
    processes::strategies::Site,
    products::{ProductError, ProductLedger},
    recipe::{Configuration, Invocation, Stage},
    sequence::StageKind,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, ts_rs::TS)]
pub struct Diagnostic {
    pub code: String,
    pub severity: Severity,
    pub invocation: String,
    pub resource: Option<String>,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<ConfigurationField>,
}
#[derive(Clone, Serialize, Deserialize, ts_rs::TS)]
pub struct ConfigurationField {
    pub feature: String,
    #[ts(type = "(string | number)[]")]
    pub path: Vec<serde_json::Value>,
}
fn issue(path: &str, message: impl Into<String>) -> Diagnostic {
    Diagnostic {
        code: "generation_configuration".into(),
        severity: Severity::Error,
        invocation: path.into(),
        resource: None,
        message: message.into(),
        field: None,
    }
}
fn product_issue(path: &str, error: ProductError) -> Diagnostic {
    let message = format!("{error:?}");
    let mut diagnostic = issue(path, message);
    if let ProductError::ExclusiveProviders { product, .. } = error {
        diagnostic.code = "product_writer".into();
        diagnostic.resource = Some(product);
    }
    diagnostic
}
pub fn inspect<'a>(
    configuration: &'a Configuration,
    registry: &impl Specifications,
    mut products: ProductLedger,
    site: Site,
) -> (Vec<Stage<'a>>, Vec<Diagnostic>) {
    // No current atlas owner declares a conditional reconciliation. Do not execute a stale
    // reviewed recipe containing one; the current source requires identical registered plans.
    if configuration
        .inputs
        .get("reconciliations")
        .is_some_and(|value| value.as_object().is_none_or(|plans| !plans.is_empty()))
    {
        return (
            Vec::new(),
            vec![issue(
                &configuration.id,
                "Execute the reconciliation plans recorded in the reviewed recipe",
            )],
        );
    }
    let stages = match schedule::stages(configuration, registry, site) {
        Ok(stages) => stages,
        Err(error) => {
            return (
                Vec::new(),
                vec![issue(&configuration.id, format!("{error:?}"))],
            )
        }
    };
    let mut diagnostics: Vec<Diagnostic> = configuration
        .inputs
        .get("features")
        .and_then(|features| features.get("diagnostics"))
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .unwrap_or_else(|error| Some(vec![issue(&configuration.id, error.to_string())]))
        .unwrap_or_default();
    for stage in &stages {
        let path = stage.context.path.join("/");
        match stage.kind {
            StageKind::EpochStart(reset) => {
                products.enter_epoch(&path);
                for fact in reset {
                    products.invalidate(fact, "epoch reset");
                }
            }
            StageKind::EpochEnd => products.enter_epoch(&path),
            StageKind::Process(call) if call.enabled(&stage.context) => {
                if registry
                    .specification(call)
                    .and_then(|spec| Ok(spec.active(site, stage)?))
                    .is_ok_and(|active| !active)
                {
                    continue;
                }
                inspect_stage(
                    configuration,
                    registry,
                    stage,
                    call,
                    &mut products,
                    &mut diagnostics,
                );
            }
            StageKind::Process(_) => {}
        }
    }
    (stages, diagnostics)
}
fn inspect_stage(
    configuration: &Configuration,
    registry: &impl Specifications,
    stage: &Stage<'_>,
    call: &Invocation,
    products: &mut ProductLedger,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let path = stage
        .context
        .epochs
        .iter()
        .map(|epoch| epoch.id.as_str())
        .chain(stage.context.path.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join(" / ");
    let process = match registry.specification(call) {
        Ok(process) => process,
        Err(error) => {
            diagnostics.push(issue(&path, format!("{error:?}")));
            return;
        }
    };
    if let Err(error) = process
        .validate_binding(stage.context.duration())
        .and_then(|()| {
            configuration
                .invocation_parameters(&process.parameters, call, &stage.context)
                .map(|_| ())
        })
    {
        diagnostics.push(issue(&path, error.to_string()));
        return;
    }
    let contract = &process.contract;
    for resource in products.missing(contract) {
        let from = products
            .invalidated_by(resource)
            .map_or(" from an earlier process".into(), |by| {
                format!(", invalidated by {by}")
            });
        diagnostics.push(Diagnostic { code: "generation_prerequisite".into(), severity: Severity::Error,
            invocation: path.clone(), resource: Some(resource.into()), field: None,
            message: format!("{path} requires {resource}{from}. Restore its producer or disable the dependent choice.") });
    }
    if let Err(error) = products.commit(contract, &path) {
        diagnostics.push(product_issue(&path, error));
    }
}
