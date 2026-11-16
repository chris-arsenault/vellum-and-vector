//! Local immutable resource files on either execution host.
mod write;
use crate::{
    numerical_input::{Array, Dtype, Snapshot},
    numerical_resource::{Descriptor, Opened, Store},
};
use std::{
    collections::BTreeMap,
    fs, io,
    path::{Path, PathBuf},
    rc::Rc,
};

pub struct NativeResources {
    root: PathBuf,
}
impl NativeResources {
    /// `root` is the resources directory owned by the backend storage adapter.
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    pub fn directory(&self, id: &str) -> io::Result<PathBuf> {
        if id.is_empty() || [".", ".."].contains(&id) || id.contains('/') {
            return Err(io::Error::other("Resource needs a path-safe identity"));
        }
        let mut encoded = String::new();
        for byte in id.bytes() {
            if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
                encoded.push(byte as char);
            } else {
                encoded.push_str(&format!("%{byte:02X}"));
            }
        }
        Ok(self.root.join(encoded))
    }
}
impl Store for NativeResources {
    fn describe(&self, id: &str) -> io::Result<Descriptor> {
        crate::numerical_resource::FORMAT.read(serde_json::from_slice(&fs::read(
            self.directory(id)?.join("resource.json"),
        )?)?)
    }
    fn open(&self, id: &str, array: &Array) -> io::Result<Opened> {
        if array.name.is_empty()
            || !array
                .name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_:-".contains(&b))
        {
            return Err(io::Error::other("Array needs a safe name"));
        }
        let directory = self.directory(id)?.join(&array.name);
        let metadata = serde_json::from_slice(&fs::read(directory.join("zarr.json"))?)?;
        array.validate(&metadata)?;
        Ok(Opened {
            metadata,
            snapshot: Rc::new(NativeSnapshot::open(&directory, array)?),
        })
    }
}
struct NativeSnapshot {
    chunks: BTreeMap<Vec<usize>, PathBuf>,
    chunk_bytes: usize,
}
impl NativeSnapshot {
    fn open(directory: &Path, array: &Array) -> io::Result<Self> {
        let bytes: usize = match array.dtype {
            Dtype::F64 => 8,
            Dtype::F32 | Dtype::I32 | Dtype::U32 => 4,
            Dtype::U8 | Dtype::I8 => 1,
        };
        let chunk_bytes = array.chunk_shape.iter().try_fold(bytes, |size, &length| {
            size.checked_mul(length)
                .ok_or_else(|| io::Error::other("Input chunk exceeds byte representation"))
        })?;
        let mut chunks = BTreeMap::new();
        let counts = array
            .shape
            .iter()
            .zip(&array.chunk_shape)
            .map(|(&n, &chunk)| n.div_ceil(chunk))
            .collect::<Vec<_>>();
        for first in 0..counts[0] {
            if counts.len() == 1 {
                insert(&mut chunks, directory, vec![first], chunk_bytes)?;
            } else {
                for second in 0..counts[1] {
                    insert(&mut chunks, directory, vec![first, second], chunk_bytes)?;
                }
            }
        }
        Ok(Self {
            chunks,
            chunk_bytes,
        })
    }
}
fn insert(
    chunks: &mut BTreeMap<Vec<usize>, PathBuf>,
    directory: &Path,
    coordinates: Vec<usize>,
    expected: usize,
) -> io::Result<()> {
    let mut path = directory.join("c");
    for coordinate in &coordinates {
        path.push(coordinate.to_string());
    }
    if fs::metadata(&path)?.len() != expected as u64 {
        return Err(io::Error::other(
            "Input chunks retain their declared type and shape",
        ));
    }
    chunks.insert(coordinates, path);
    Ok(())
}
impl Snapshot for NativeSnapshot {
    fn read(&self, coordinates: &[usize]) -> io::Result<Vec<u8>> {
        let path = self
            .chunks
            .get(coordinates)
            .ok_or_else(|| io::Error::other("A committed input chunk is missing"))?;
        // The host pins immutable resources for the run, as the browser input adapter does.
        let bytes = fs::read(path)?;
        if bytes.len() != self.chunk_bytes {
            return Err(io::Error::other(
                "Input chunks retain their declared type and shape",
            ));
        }
        Ok(bytes)
    }
}
