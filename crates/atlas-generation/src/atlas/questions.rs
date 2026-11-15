//! Every process contributes its own answers before a run binds the shared question book.
use super::{environment::Environment, terrain::Terrain};
use crate::{
    answers::QuestionBook,
    ecology,
    execution::{ExecutionError, ExecutionResult, Query},
    field::{people, Field},
    magic,
    scale_settings::ResolvedSettings,
    storage::ReadBand,
};

// Arconis: docs/architecture/subsystems.arconis#item=q_register — registers each system's question responders beside that system.
pub fn base(
    profile: &ResolvedSettings,
    environment: &Environment,
    terrain: &Terrain,
    rivers: Query<Field, ReadBand<u32>>,
) -> ExecutionResult<QuestionBook<Field, &'static str>> {
    let number = |key: &str| {
        profile
            .values()
            .get(key)
            .and_then(serde_json::Value::as_f64)
            .ok_or_else(|| ExecutionError::Failed(format!("Question responders require {key}")))
    };
    let mut book = QuestionBook::default();
    environment.respond(&mut book, number("FluvialReferenceRunoff")?)?;
    terrain.respond(&mut book, number("SedimentCarry")?)?;
    ecology::groups::respond(&mut book)?;
    magic::responders::respond(&mut book, number("ChargedIceErosion")?)?;
    people::yields::respond(&mut book, rivers.clone(), vec![])?;
    people::travel::respond(&mut book, rivers, vec![])?;
    people::questions::built_hold(&mut book, vec![])?;
    people::questions::rules(&mut book)?;
    people::crafts::breaks(&mut book, vec![])?;
    Ok(book)
}
