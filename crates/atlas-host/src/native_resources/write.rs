use crate::{native_resources::NativeResources, numerical_output::Sink};
use std::{
    fs,
    io::{self, Write},
    path::{Component, Path},
};

impl Sink for NativeResources {
    fn committed(&self, id: &str) -> io::Result<Option<serde_json::Value>> {
        let path = self.directory(id)?.join("resource.json");
        if !path.exists() {
            return Ok(None);
        }
        let value: serde_json::Value = serde_json::from_slice(&fs::read(path)?)?;
        let descriptor: crate::numerical_resource::Descriptor =
            crate::numerical_resource::FORMAT.read(value.clone())?;
        Ok((descriptor.state == crate::numerical_resource::State::Ready).then_some(value))
    }
    async fn create(&mut self, id: &str) -> io::Result<()> {
        // Existing immutable resources are never overwritten by a new publication.
        let directory = self.directory(id)?;
        if directory.exists() {
            let descriptor = directory.join("resource.json");
            if descriptor.exists() {
                let value: crate::numerical_resource::Descriptor =
                    crate::numerical_resource::FORMAT
                        .read(serde_json::from_slice(&fs::read(descriptor)?)?)?;
                if value.state != crate::numerical_resource::State::Working {
                    return Err(io::Error::other("Completed resources are immutable"));
                }
            }
            fs::remove_dir_all(&directory)?;
        }
        fs::create_dir(self.directory(id)?)
    }
    async fn write(&mut self, id: &str, path: &str, bytes: &[u8]) -> io::Result<()> {
        let relative = Path::new(path);
        if relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
            || path.is_empty()
        {
            return Err(io::Error::other(
                "Resource writes stay inside their resource directory",
            ));
        }
        let path = self.directory(id)?.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        // Chunks are private until the ready descriptor commits. Only that descriptor
        // needs replacement staging; chunk writes keep their ordinary streaming path.
        let staged = if relative == Path::new("resource.json") {
            path.with_extension("tmp")
        } else {
            path.clone()
        };
        let mut output = fs::File::create(&staged)?;
        output.write_all(bytes)?;
        output.sync_all()?;
        drop(output);
        if staged != path {
            fs::rename(staged, path)?;
        }
        Ok(())
    }
    async fn remove(&mut self, id: &str) -> io::Result<()> {
        fs::remove_dir_all(self.directory(id)?)
    }
}
