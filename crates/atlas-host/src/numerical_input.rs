//! Immutable local Zarr inputs from the current resource format. No remote field reader.
use atlas_generation::{
    lattice::BLOCK_CELLS,
    storage::{Band, ReadBand, Sample, SharedCache},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{io, rc::Rc};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Dtype {
    #[serde(rename = "float64")]
    F64,
    #[serde(rename = "float32")]
    F32,
    #[serde(rename = "int32")]
    I32,
    #[serde(rename = "uint32")]
    U32,
    #[serde(rename = "uint8")]
    U8,
    #[serde(rename = "int8")]
    I8,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alias {
    pub resource_id: String,
    pub array: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Array {
    pub name: String,
    pub dtype: Dtype,
    pub shape: Vec<usize>,
    pub chunk_shape: Vec<usize>,
    pub unit: String,
    pub quantity: Quantity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<Alias>,
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quantity {
    Intensive,
    Extensive,
    Category,
    Topology,
}
impl Array {
    pub fn chunk_keys(&self, path: &str) -> io::Result<Vec<String>> {
        self.length()?;
        let counts = self
            .shape
            .iter()
            .zip(&self.chunk_shape)
            .map(|(n, chunk)| n.div_ceil(*chunk))
            .collect::<Vec<_>>();
        let mut keys = Vec::new();
        for first in 0..counts[0] {
            if counts.len() == 1 {
                keys.push(format!("{path}/c/{first}"));
            } else {
                for second in 0..counts[1] {
                    keys.push(format!("{path}/c/{first}/{second}"));
                }
            }
        }
        Ok(keys)
    }
    pub fn length(&self) -> io::Result<usize> {
        if self.shape.is_empty()
            || self.shape.len() > 2
            || self.shape.len() != self.chunk_shape.len()
            || self.chunk_shape.contains(&0)
        {
            return Err(io::Error::other(
                "Numerical arrays require one or two dimensions and positive chunk sizes",
            ));
        }
        product(&self.shape)
    }
    pub fn validate(&self, metadata: &Value) -> io::Result<()> {
        self.length()?;
        let grid = json!({"name":"regular","configuration":{"chunk_shape":self.chunk_shape}});
        let keys = json!({"name":"default","configuration":{"separator":"/"}});
        if metadata.get("chunk_grid") != Some(&grid)
            || metadata.get("chunk_key_encoding") != Some(&keys)
            || metadata.get("zarr_format") != Some(&json!(3))
            || metadata.get("node_type") != Some(&json!("array"))
            || metadata.get("data_type") != Some(&json!(self.dtype))
            || metadata.get("shape") != Some(&json!(self.shape))
        {
            return Err(io::Error::other(
                "Numerical input metadata must retain its declared type, shape and chunk encoding",
            ));
        }
        let codecs = metadata
            .get("codecs")
            .and_then(Value::as_array)
            .ok_or_else(|| io::Error::other("Numerical input requires declared byte codecs"))?;
        if codecs.len() > 1
            || codecs.iter().any(|codec| {
                codec.get("name") != Some(&json!("bytes"))
                    || codec
                        .get("configuration")
                        .and_then(|c| c.get("endian"))
                        .is_some_and(|endian| endian != "little")
            })
        {
            return Err(io::Error::other(
                "Direct inputs use uncompressed little-endian Zarr bytes",
            ));
        }
        Ok(())
    }
    fn tiles(&self) -> Tiles {
        if self.shape.len() == 1 {
            Tiles {
                rows: 1,
                columns: self.shape[0],
                chunk_rows: 1,
                chunk_columns: self.chunk_shape[0],
            }
        } else {
            Tiles {
                rows: self.shape[0],
                columns: self.shape[1],
                chunk_rows: self.chunk_shape[0],
                chunk_columns: self.chunk_shape[1],
            }
        }
    }
}
fn product(shape: &[usize]) -> io::Result<usize> {
    shape.iter().try_fold(1usize, |length, &n| {
        length
            .checked_mul(n)
            .ok_or_else(|| io::Error::other("Numerical array exceeds index representation"))
    })
}
/// The adapter pins committed local bytes for this handle's lifetime. Hosts can reuse their
/// existing chunk byte cache; the common Band cache owns decoded numerical blocks.
pub trait Snapshot {
    fn read(&self, coordinates: &[usize]) -> io::Result<Vec<u8>>;
}
pub trait InputSample: Sample {
    const DTYPE: Dtype;
    fn decode(bytes: &[u8]) -> Self;
}
macro_rules! input_sample {
    ($($ty:ty => $kind:ident),*) => {$(impl InputSample for $ty {
        const DTYPE: Dtype = Dtype::$kind;
        fn decode(bytes: &[u8]) -> Self { Self::from_le_bytes(bytes.try_into().expect("One declared sample")) }
    })*};
}
input_sample!(f64=>F64, f32=>F32, i32=>I32, u32=>U32, u8=>U8, i8=>I8);
pub fn open<T: InputSample>(
    array: Array,
    metadata: &Value,
    snapshot: Rc<dyn Snapshot>,
    cache: SharedCache,
) -> io::Result<ReadBand<T>> {
    array.validate(metadata)?;
    if array.dtype != T::DTYPE {
        return Err(io::Error::other(
            "Input band type differs from its declared scalar type",
        ));
    }
    let length = array.length()?;
    let input = Input {
        array,
        snapshot,
        length,
    };
    Ok(Band::from_source(
        length,
        T::default(),
        cache,
        Rc::new(move |block, into| input.read(block * BLOCK_CELLS, into)),
    )
    .read_only())
}
struct Tiles {
    rows: usize,
    columns: usize,
    chunk_rows: usize,
    chunk_columns: usize,
}
struct Input {
    array: Array,
    snapshot: Rc<dyn Snapshot>,
    length: usize,
}
impl Input {
    fn read<T: InputSample>(&self, start: usize, into: &mut [T]) -> io::Result<()> {
        if start
            .checked_add(into.len())
            .is_none_or(|end| end > self.length)
        {
            return Err(io::Error::other("Read stays inside its numerical input"));
        }
        if into.is_empty() {
            return Ok(());
        }
        let tiles = self.array.tiles();
        let first = start / tiles.columns;
        let last = (tiles.rows - 1).min((start + into.len() - 1) / tiles.columns);
        for row in first / tiles.chunk_rows..=last / tiles.chunk_rows {
            for column in 0..tiles.columns.div_ceil(tiles.chunk_columns) {
                self.copy_tile([row, column], [first, last], start, into)?;
            }
        }
        Ok(())
    }
    fn copy_tile<T: InputSample>(
        &self,
        tile: [usize; 2],
        rows: [usize; 2],
        start: usize,
        into: &mut [T],
    ) -> io::Result<()> {
        let t = self.array.tiles();
        let end = start + into.len();
        let c0 = tile[1] * t.chunk_columns;
        let c1 = t.columns.min(c0 + t.chunk_columns);
        let mut bytes = None;
        for row in rows[0].max(tile[0] * t.chunk_rows)
            ..=rows[1].min(tile[0] * t.chunk_rows + t.chunk_rows - 1)
        {
            let from = start.max(row * t.columns + c0);
            let to = end.min(row * t.columns + c1);
            if from >= to {
                continue;
            }
            if bytes.is_none() {
                let coordinates = if self.array.shape.len() == 1 {
                    &tile[1..]
                } else {
                    &tile[..]
                };
                let data = self.snapshot.read(coordinates)?;
                let expected = product(&self.array.chunk_shape)?
                    .checked_mul(T::BYTES)
                    .ok_or_else(|| io::Error::other("Input chunk exceeds byte representation"))?;
                if data.len() != expected {
                    return Err(io::Error::other(
                        "Input chunks retain their declared type and shape",
                    ));
                }
                bytes = Some(data);
            }
            let at = (row - tile[0] * t.chunk_rows) * t.chunk_columns + from - row * t.columns - c0;
            let source =
                &bytes.as_ref().expect("Opened tile")[at * T::BYTES..(at + to - from) * T::BYTES];
            for (value, bytes) in into[from - start..to - start]
                .iter_mut()
                .zip(source.chunks_exact(T::BYTES))
            {
                *value = T::decode(bytes);
            }
        }
        Ok(())
    }
}
