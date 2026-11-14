use crate::{native_resources::NativeResources, numerical_output::Sink};
use std::{
    fs,
    io::{self, Write},
    path::{Component, Path},
};

impl Sink for NativeResources {
    async fn create(&mut self, id: &str) -> io::Result<()> {
        // Existing immutable resources are never overwritten by a new publication.
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
        let mut output = fs::File::create(path)?;
        output.write_all(bytes)?;
        output.sync_all()
    }
    async fn remove(&mut self, id: &str) -> io::Result<()> {
        fs::remove_dir_all(self.directory(id)?)
    }
}
