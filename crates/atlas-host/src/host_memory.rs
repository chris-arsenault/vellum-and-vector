//! Native numerical allocation leaves room for geometry, encoders, database and operating system.
use atlas_generation::storage::MemoryBudget;
use std::{env, fs, io, sync::Arc};

const NUMERICAL_MEMORY_SHARE: usize = 60;

pub fn generation_budget() -> io::Result<Arc<MemoryBudget>> {
    let bytes = match env::var("ATLAS_GENERATION_MEMORY_BYTES") {
        Ok(value) => value.parse::<usize>().map_err(io::Error::other)?,
        Err(env::VarError::NotPresent) => available()? / 100 * NUMERICAL_MEMORY_SHARE,
        Err(error) => return Err(io::Error::other(error)),
    };
    if bytes == 0 {
        return Err(io::Error::other(
            "Set a positive ATLAS_GENERATION_MEMORY_BYTES",
        ));
    }
    Ok(MemoryBudget::new(bytes))
}
fn available() -> io::Result<usize> {
    let info = fs::read_to_string("/proc/meminfo").map_err(|error| {
        io::Error::other(format!(
            "Cannot read available host memory: {error}; set ATLAS_GENERATION_MEMORY_BYTES"
        ))
    })?;
    let kib = info
        .lines()
        .find_map(|line| line.strip_prefix("MemAvailable:"))
        .and_then(|value| value.split_whitespace().next())
        .ok_or_else(|| io::Error::other("Host memory has no MemAvailable value"))?
        .parse::<usize>()
        .map_err(io::Error::other)?;
    let host = kib
        .checked_mul(1024)
        .ok_or_else(|| io::Error::other("Host memory exceeds address representation"))?;
    let maximum = match fs::read_to_string("/sys/fs/cgroup/memory.max") {
        Ok(value) if value.trim() != "max" => {
            value.trim().parse::<usize>().map_err(io::Error::other)?
        }
        Ok(_) => return Ok(host),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(host),
        Err(error) => return Err(error),
    };
    let used = fs::read_to_string("/sys/fs/cgroup/memory.current")?
        .trim()
        .parse::<usize>()
        .map_err(io::Error::other)?;
    Ok(host.min(maximum.saturating_sub(used)))
}
