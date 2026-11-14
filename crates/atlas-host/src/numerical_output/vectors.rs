use crate::numerical_input::{Array, Dtype, Quantity};
use atlas_generation::{
    field::{
        projection::{channels::Quantity as FieldQuantity, Surface},
        schema::NumericBand,
    },
    lattice::BLOCK_CELLS,
    reconstruction::{topology::Topology, Layout},
};
use serde_json::{json, Value};
use std::io;
pub const REGULAR_WIDTH: usize = 256;
pub const REGULAR_HEIGHT: usize = 64;
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Group {
    Cells,
    Faces,
    Tree,
}
impl Group {
    pub fn name(self) -> &'static str {
        match self {
            Self::Cells => "cells",
            Self::Faces => "faces",
            Self::Tree => "tree",
        }
    }
}
pub enum Values {
    Band(NumericBand),
    Bounds(Topology),
}
pub struct Vector {
    pub array: Array,
    pub values: Values,
    pub group: Group,
    pub components: usize,
}
impl Vector {
    pub fn linear(name: &str, values: NumericBand, group: Group, components: usize) -> Self {
        let dtype = dtype(&values);
        Self {
            array: Array {
                name: name.into(),
                dtype,
                shape: vec![values.len()],
                chunk_shape: vec![BLOCK_CELLS * components],
                unit: if name == "measures" {
                    "square-metre"
                } else {
                    "topology"
                }
                .into(),
                quantity: if name == "measures" {
                    Quantity::Extensive
                } else {
                    Quantity::Topology
                },
                source: None,
            },
            values: Values::Band(values),
            group,
            components,
        }
    }
    pub fn value(&self, cell: usize) -> io::Result<f64> {
        match &self.values {
            Values::Band(values) => values.get(cell),
            Values::Bounds(topology) => Ok(topology.cell(cell / 4)?[cell % 4]),
        }
    }
    pub fn regular(&mut self, width: usize, height: usize) {
        self.array.shape = vec![height, width];
        self.array.chunk_shape = vec![REGULAR_HEIGHT, REGULAR_WIDTH];
    }
    pub fn metadata(&self) -> Value {
        json!({"zarr_format":3,"node_type":"array","shape":self.array.shape,"data_type":self.array.dtype,
            "chunk_grid":{"name":"regular","configuration":{"chunk_shape":self.array.chunk_shape}},
            "chunk_key_encoding":{"name":"default","configuration":{"separator":"/"}},"fill_value":0,
            "codecs":[{"name":"bytes","configuration":{"endian":"little"}}],"attributes":{}})
    }
    pub fn chunks(&self) -> impl Iterator<Item = Vec<usize>> + '_ {
        let array = &self.array;
        let rows = array.shape[0].div_ceil(array.chunk_shape[0]);
        let columns = if array.shape.len() == 2 {
            array.shape[1].div_ceil(array.chunk_shape[1])
        } else {
            1
        };
        (0..rows).flat_map(move |row| {
            (0..columns).map(move |column| {
                if array.shape.len() == 2 {
                    vec![row, column]
                } else {
                    vec![row]
                }
            })
        })
    }
    fn index(&self, coordinates: &[usize], cell: usize) -> Option<usize> {
        let array = &self.array;
        if coordinates.len() == 1 {
            let at = coordinates[0] * array.chunk_shape[0] + cell;
            return (at < array.shape[0]).then_some(at);
        }
        let row = coordinates[0] * array.chunk_shape[0] + cell / array.chunk_shape[1];
        let column = coordinates[1] * array.chunk_shape[1] + cell % array.chunk_shape[1];
        (row < array.shape[0] && column < array.shape[1]).then_some(row * array.shape[1] + column)
    }
    pub fn chunk(&self, coordinates: &[usize]) -> io::Result<Vec<u8>> {
        let count = self.array.chunk_shape.iter().product();
        let mut bytes = Vec::new();
        for cell in 0..count {
            let value = self
                .index(coordinates, cell)
                .map_or(Ok(0.0), |index| self.value(index))?;
            macro_rules! write {
                ($ty:ty) => {
                    bytes.extend_from_slice(&(value as $ty).to_le_bytes())
                };
            }
            match self.array.dtype {
                Dtype::F64 => write!(f64),
                Dtype::F32 => write!(f32),
                Dtype::I32 => write!(i32),
                Dtype::U32 => write!(u32),
                Dtype::U8 => write!(u8),
                Dtype::I8 => write!(i8),
            }
        }
        Ok(bytes)
    }
}
pub fn channel(surface: &Surface, name: &str, index: usize) -> io::Result<Vector> {
    let source = surface
        .channels()
        .get(name)
        .ok_or_else(|| io::Error::other(format!("Missing published channel {name}")))?;
    let mut vector = Vector::linear(
        &format!("channel_{index}"),
        source.values(),
        Group::Cells,
        1,
    );
    vector.array.unit.clone_from(&source.unit);
    vector.array.quantity = match source.quantity {
        FieldQuantity::Intensive => Quantity::Intensive,
        FieldQuantity::Extensive => Quantity::Extensive,
        FieldQuantity::Category => Quantity::Category,
    };
    if let Layout::Raster { width, height } = surface.grid().layout {
        vector.regular(width, height);
    }
    Ok(vector)
}
fn dtype(band: &NumericBand) -> Dtype {
    match band {
        NumericBand::F64(_) => Dtype::F64,
        NumericBand::F32(_) => Dtype::F32,
        NumericBand::I32(_) => Dtype::I32,
        NumericBand::U32(_) => Dtype::U32,
        NumericBand::U8(_) => Dtype::U8,
        NumericBand::I8(_) => Dtype::I8,
    }
}
