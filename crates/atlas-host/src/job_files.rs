//! Private job requests and one replaced checkpoint, on the selected execution host.
use atlas_generation::checkpoint::{Point, Recovery};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{self, BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    time::Instant,
};

const FORMAT: atlas_gis::stored::Format = atlas_gis::stored::Format {
    kind: "generation-job",
    revision: 1,
    semantics: "private-job-pinned-inputs",
};
/// How many of a job's newest epoch previews stay on disk.
const KEPT_PREVIEWS: usize = 8;
fn preview_name(epoch: usize) -> String {
    format!("preview-{epoch}.cbor")
}
#[derive(Clone)]
pub struct JobFiles {
    pub directory: PathBuf,
    started: Instant,
    elapsed_before: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub point: Point,
    pub written_at: String,
    #[serde(default)]
    pub elapsed_seconds: f64,
}

impl JobFiles {
    pub fn new(root: &Path, id: &str) -> io::Result<Self> {
        if id.is_empty() || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
            return Err(io::Error::other("Invalid generation job identity"));
        }
        let directory = root.join(id);
        fs::create_dir_all(&directory)?;
        let mut files = Self {
            directory,
            started: Instant::now(),
            elapsed_before: 0.0,
        };
        files.elapsed_before = files
            .checkpoint()
            .ok()
            .flatten()
            .map_or(0.0, |c| c.elapsed_seconds);
        Ok(files)
    }
    pub fn read<T: DeserializeOwned>(&self, name: &str) -> io::Result<Option<T>> {
        match File::open(self.directory.join(name)) {
            Ok(file) => FORMAT
                .read(serde_json::from_reader(BufReader::new(file))?)
                .map(Some),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }
    /// Retain an epoch's preview as CBOR. A job keeps only its newest previews: an observer
    /// reads each soon after its event, and a town's preview is tens of megabytes.
    pub fn write_preview(&self, epoch: usize, value: &impl Serialize) -> io::Result<()> {
        self.atomic(&preview_name(epoch), |writer| {
            ciborium::into_writer(value, writer).map_err(io::Error::other)
        })?;
        if let Some(old) = epoch.checked_sub(KEPT_PREVIEWS) {
            match fs::remove_file(self.directory.join(preview_name(old))) {
                Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
                _ => {}
            }
        }
        Ok(())
    }
    /// Remove every retained preview: when the job finishes, or when a resumed run starts
    /// numbering its epochs again.
    pub fn remove_previews(&self) -> io::Result<()> {
        for entry in fs::read_dir(&self.directory)? {
            let path = entry?.path();
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            if name.starts_with("preview-") && name.ends_with(".cbor") {
                fs::remove_file(&path)?;
            }
        }
        Ok(())
    }
    /// An epoch's retained preview bytes, while it is among the newest kept.
    pub fn preview(&self, epoch: usize) -> io::Result<Option<Vec<u8>>> {
        match fs::read(self.directory.join(preview_name(epoch))) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }
    pub fn write<T: Serialize>(&self, name: &str, value: &T) -> io::Result<()> {
        let value = FORMAT.write(value)?;
        self.atomic(name, |writer| {
            serde_json::to_writer(writer, &value).map_err(Into::into)
        })
    }
    fn atomic(
        &self,
        name: &str,
        write: impl FnOnce(&mut BufWriter<File>) -> io::Result<()>,
    ) -> io::Result<()> {
        let staging = self.directory.join(format!("{name}.tmp"));
        let result = (|| {
            let mut writer = BufWriter::new(File::create(&staging)?);
            write(&mut writer)?;
            writer.flush()?;
            writer.get_ref().sync_all()?;
            drop(writer);
            fs::rename(&staging, self.directory.join(name))?;
            #[cfg(not(target_arch = "wasm32"))]
            File::open(&self.directory)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(staging);
        }
        result
    }
    pub fn checkpoint(&self) -> io::Result<Option<Checkpoint>> {
        match File::open(self.directory.join("checkpoint")) {
            Ok(file) => ciborium::from_reader(BufReader::new(file))
                .map(Some)
                .map_err(io::Error::other),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }
    pub fn retire_checkpoint(&self) -> io::Result<()> {
        match fs::remove_file(self.directory.join("checkpoint")) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        }
    }
}
impl Recovery for JobFiles {
    fn open(&mut self) -> io::Result<Option<Box<dyn io::Read>>> {
        match File::open(self.directory.join("checkpoint")) {
            Ok(file) => {
                let mut reader = BufReader::new(file);
                let _: Checkpoint = ciborium::from_reader(&mut reader).map_err(io::Error::other)?;
                Ok(Some(Box::new(reader)))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }
    fn replace(
        &mut self,
        point: &Point,
        write: &mut dyn FnMut(&mut dyn Write) -> io::Result<()>,
    ) -> io::Result<()> {
        let started = Instant::now();
        let checkpoint = Checkpoint {
            point: point.clone(),
            written_at: now(),
            elapsed_seconds: self.elapsed_before + self.started.elapsed().as_secs_f64(),
        };
        // owner-direction(2026-11-15): only one checkpoint per job - overwrite data, not new.
        self.atomic("checkpoint", |writer| {
            ciborium::into_writer(&checkpoint, &mut *writer).map_err(io::Error::other)?;
            write(writer)
        })?;
        eprintln!(
            "{}",
            serde_json::json!({"event":"generation.checkpoint", "jobId":self.directory.file_name().and_then(|s| s.to_str()), "point":point, "seconds":started.elapsed().as_secs_f64(), "bytes":fs::metadata(self.directory.join("checkpoint"))?.len()})
        );
        Ok(())
    }
}
pub fn now() -> String {
    #[cfg(not(target_arch = "wasm32"))]
    {
        chrono::Utc::now().to_rfc3339()
    }
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::new_0().to_iso_string().into()
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    /// A job keeps its newest previews as CBOR files and drops older ones as it goes.
    #[test]
    fn only_the_newest_previews_are_kept() {
        let root = std::env::temp_dir().join(format!("atlas-previews-{}", uuid::Uuid::new_v4()));
        let files = JobFiles::new(&root, "job").unwrap();
        for epoch in 0..KEPT_PREVIEWS + 3 {
            files.write_preview(epoch, &vec![epoch as u32; 4]).unwrap();
        }
        assert!(files.preview(2).unwrap().is_none());
        let newest = files.preview(KEPT_PREVIEWS + 2).unwrap().unwrap();
        let decoded: Vec<u32> = ciborium::from_reader(newest.as_slice()).unwrap();
        assert_eq!(decoded, vec![(KEPT_PREVIEWS + 2) as u32; 4]);
        assert!(files.preview(3).unwrap().is_some());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_replacement_retains_one_committed_checkpoint() {
        let root = std::env::temp_dir().join(format!("atlas-checkpoint-{}", uuid::Uuid::new_v4()));
        let mut files = JobFiles::new(&root, "job").unwrap();
        files
            .replace(&Point::WorldFormation, &mut |writer| {
                writer.write_all(b"owner state")
            })
            .unwrap();
        assert!(files
            .replace(&Point::Publication, &mut |_| Err(io::Error::other(
                "supplied write failure"
            )))
            .is_err());
        assert_eq!(
            files.checkpoint().unwrap().unwrap().point,
            Point::WorldFormation
        );
        let mut restored = String::new();
        files
            .open()
            .unwrap()
            .unwrap()
            .read_to_string(&mut restored)
            .unwrap();
        assert_eq!(restored, "owner state");
        assert_eq!(fs::read_dir(&files.directory).unwrap().count(), 1);
        files
            .replace(&Point::Publication, &mut |writer| {
                writer.write_all(b"ready")
            })
            .unwrap();
        assert_eq!(
            files.checkpoint().unwrap().unwrap().point,
            Point::Publication
        );
        assert_eq!(fs::read_dir(&files.directory).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
