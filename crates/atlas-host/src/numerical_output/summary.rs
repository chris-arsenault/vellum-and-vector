use super::{vectors::Vector, Definition, Slice};
use crate::{
    numerical_input::{Array, Quantity},
    numerical_resource::Field,
};
use atlas_generation::{field::projection::Surface, storage::ReadBand};
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::BTreeMap, io};

#[derive(Clone, Serialize)]
struct Summary {
    range: [f64; 2],
    categories: Vec<f64>,
}
impl Default for Summary {
    fn default() -> Self {
        Self {
            range: [f64::INFINITY, f64::NEG_INFINITY],
            categories: Vec::new(),
        }
    }
}
impl Summary {
    fn merge(&mut self, other: &Self) {
        self.range = [
            self.range[0].min(other.range[0]),
            self.range[1].max(other.range[1]),
        ];
        self.categories.extend_from_slice(&other.categories);
        self.categories.sort_by(f64::total_cmp);
        self.categories.dedup_by(|a, b| *a == *b);
    }
    fn finish(&mut self) {
        if !self.range[0].is_finite() {
            self.range = [0.0, 1.0];
        }
    }
}
fn indices<'a>(array: &'a Array, slice: &'a Slice) -> impl Iterator<Item = usize> + 'a {
    let (start, rows, width, stride) = if slice.shape.len() == 1 {
        (slice.offset[0], 1, slice.shape[0], slice.shape[0])
    } else {
        (
            slice.offset[0] * array.shape[1] + slice.offset[1],
            slice.shape[0],
            slice.shape[1],
            array.shape[1],
        )
    };
    (0..rows).flat_map(move |row| (0..width).map(move |column| start + row * stride + column))
}
fn summarize(vector: &Vector, slice: &Slice, active: &ReadBand<u8>) -> io::Result<Summary> {
    let mut result = Summary::default();
    for index in indices(&vector.array, slice) {
        let value = vector.value(index)?;
        if active.get(index)? == 0 || !value.is_finite() {
            continue;
        }
        result.range = [result.range[0].min(value), result.range[1].max(value)];
        if vector.array.quantity == Quantity::Category {
            result.categories.push(value);
        }
    }
    result.categories.sort_by(f64::total_cmp);
    result.categories.dedup_by(|a, b| *a == *b);
    Ok(result)
}
pub fn summaries(
    surface: &Surface,
    definition: &Definition,
    field: &Field,
    vectors: &[Vector],
) -> io::Result<Value> {
    let active = surface.active();
    let mut all: BTreeMap<String, Summary> = BTreeMap::new();
    let mut partitions = BTreeMap::new();
    for partition in definition.partitions.iter().filter(|p| p.cell_count > 0) {
        let mut current = BTreeMap::new();
        for (name, key) in &field.channels {
            let vector = vectors
                .iter()
                .find(|v| v.array.name == *key)
                .ok_or_else(|| io::Error::other("Missing published vector"))?;
            let slice = partition
                .array_slices
                .get(key)
                .ok_or_else(|| io::Error::other("Missing channel partition"))?;
            let mut summary = summarize(vector, slice, &active)?;
            all.entry(name.clone()).or_default().merge(&summary);
            summary.finish();
            current.insert(name.clone(), summary);
        }
        partitions.insert(partition.id.clone(), current);
    }
    for summary in all.values_mut() {
        summary.finish();
    }
    Ok(json!({"summaries":all,"partitionSummaries":partitions}))
}
