//! Owners register opaque package operations. Transport never reaches into their storage.
use super::TransportShares;
use crate::execution::{Command, CommandContext, ExecutionError, ExecutionResult};

pub struct Carriers<S> {
    registered: Vec<(String, Command<S, TransportShares>)>,
}
impl<S> Default for Carriers<S> {
    fn default() -> Self {
        Self {
            registered: Vec::new(),
        }
    }
}
impl<S: 'static> Carriers<S> {
    pub fn register(
        &mut self,
        owner: &str,
        command: Command<S, TransportShares>,
    ) -> ExecutionResult<()> {
        if self.registered.iter().any(|(name, _)| name == owner) {
            return Err(ExecutionError::Failed(format!(
                "{owner} already carries its state"
            )));
        }
        self.registered.push((owner.into(), command));
        Ok(())
    }
    pub fn carry(
        &self,
        context: &mut CommandContext<'_, S>,
        plan: &TransportShares,
    ) -> ExecutionResult<()> {
        for (_, command) in &self.registered {
            context.run(command, plan)?;
        }
        Ok(())
    }
}
