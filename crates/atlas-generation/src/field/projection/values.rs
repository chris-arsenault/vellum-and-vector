use super::sampling::write_range;
use crate::{
    field::schema::NumericBand,
    storage::{Band, Coverage},
};
use std::io;

pub enum Values {
    F64(Band<f64>),
    F32(Band<f32>),
    I32(Band<i32>),
    U32(Band<u32>),
    U8(Band<u8>),
    I8(Band<i8>),
}
impl Values {
    pub fn snapshot(&self, coverage: &mut Coverage) -> io::Result<Self> {
        Ok(match self {
            Self::F64(v) => Self::F64(coverage.copy_band(v)?),
            Self::F32(v) => Self::F32(coverage.copy_band(v)?),
            Self::I32(v) => Self::I32(coverage.copy_band(v)?),
            Self::U32(v) => Self::U32(coverage.copy_band(v)?),
            Self::U8(v) => Self::U8(coverage.copy_band(v)?),
            Self::I8(v) => Self::I8(coverage.copy_band(v)?),
        })
    }
    pub fn like(source: &NumericBand, coverage: &mut Coverage) -> Self {
        match source {
            NumericBand::F64(_) => Self::F64(coverage.allocate(0.0)),
            NumericBand::F32(_) => Self::F32(coverage.allocate(0.0)),
            NumericBand::I32(_) => Self::I32(coverage.allocate(0)),
            NumericBand::U32(_) => Self::U32(coverage.allocate(0)),
            NumericBand::U8(_) => Self::U8(coverage.allocate(0)),
            NumericBand::I8(_) => Self::I8(coverage.allocate(0)),
        }
    }
    pub fn read(&self) -> NumericBand {
        match self {
            Self::F64(v) => v.read_only().into(),
            Self::F32(v) => v.read_only().into(),
            Self::I32(v) => v.read_only().into(),
            Self::U32(v) => v.read_only().into(),
            Self::U8(v) => v.read_only().into(),
            Self::I8(v) => v.read_only().into(),
        }
    }
    pub fn write(&mut self, start: usize, values: &[f64]) -> io::Result<()> {
        match self {
            Self::F64(v) => write_range(v, start, values),
            Self::F32(v) => write_range(
                v,
                start,
                &values.iter().map(|&n| n as f32).collect::<Vec<_>>(),
            ),
            Self::I32(v) => write_range(
                v,
                start,
                &values.iter().map(|&n| uint32(n) as i32).collect::<Vec<_>>(),
            ),
            Self::U32(v) => write_range(
                v,
                start,
                &values.iter().map(|&n| uint32(n)).collect::<Vec<_>>(),
            ),
            Self::U8(v) => write_range(
                v,
                start,
                &values.iter().map(|&n| uint32(n) as u8).collect::<Vec<_>>(),
            ),
            Self::I8(v) => write_range(
                v,
                start,
                &values.iter().map(|&n| uint32(n) as i8).collect::<Vec<_>>(),
            ),
        }
    }
}
// Typed-array assignment truncates and wraps integer samples; it does not saturate.
fn uint32(value: f64) -> u32 {
    if !value.is_finite() {
        return 0;
    }
    value.trunc().rem_euclid(4294967296.0) as u32
}
