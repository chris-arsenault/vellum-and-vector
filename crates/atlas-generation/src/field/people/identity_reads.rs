use crate::{
    field::Field,
    human::identity::{self, Tradition},
};
// hpc-exempt: one typed band per tradition identity; all cell values stay in bands.
type Shares = std::collections::BTreeMap<i32, crate::storage::Band<f64>>;
use std::io;
pub fn shares(field: &Field, tradition: Tradition) -> io::Result<Shares> {
    // hpc-exempt: tradition-code metadata indexing typed numerical bands.
    let mut bands = std::collections::BTreeMap::new();
    for cell in 0..field.mesh.len() {
        let column = field.people.column(cell)?;
        let everyone = column.iter().map(|layer| layer.people).sum::<f64>();
        if everyone <= 0.0 {
            continue;
        }
        for (code, people) in identity::held(&column, tradition) {
            let band = bands
                .entry(code)
                .or_insert_with(|| field.coverage.borrow_mut().allocate(0.0));
            band.set(cell, people / everyone)?;
        }
    }
    Ok(bands)
}
pub struct Leading {
    pub code: Vec<i32>,
    pub people: Vec<f64>,
}
impl Leading {
    fn new(count: usize) -> Self {
        Self {
            code: vec![0; count],
            people: vec![0.0; count],
        }
    }
}
pub fn leading_of(field: &Field, tradition: Tradition) -> io::Result<Leading> {
    let mut values = Leading::new(field.mesh.len());
    for cell in 0..field.mesh.len() {
        (values.code[cell], values.people[cell]) =
            identity::leading(&field.people.column(cell)?, tradition);
    }
    Ok(values)
}
pub fn leading_all(field: &Field) -> io::Result<[Leading; 4]> {
    let mut all = std::array::from_fn(|_| Leading::new(field.mesh.len()));
    for cell in 0..field.mesh.len() {
        let column = field.people.column(cell)?;
        for (values, tradition) in all.iter_mut().zip(Tradition::SOCIAL) {
            (values.code[cell], values.people[cell]) = identity::leading(&column, tradition);
        }
    }
    Ok(all)
}
