use super::{LatticeInput, PeriodicFrame, TriangularFrame, TriangularLattice, TRIANGLE_AREA};
use atlas_map::Bounds;

pub struct WorldShape {
    pub columns: usize,
    pub rows: usize,
    pub spacing: f64,
    pub spacing_y: f64,
}
pub fn world_shape(
    bounds: Bounds,
    samples: f64,
    padding: f64,
    wrap: bool,
    poles: bool,
) -> Result<WorldShape, &'static str> {
    bounds.validate().map_err(|_| "Invalid world bounds")?;
    if !samples.is_finite() || samples <= 0.0 || !padding.is_finite() || padding < 0.0 {
        return Err("Invalid sample count or padding");
    }
    let width = bounds.2 - bounds.0;
    let height = bounds.3 - bounds.1;
    let desired =
        (((width + 2.0 * padding) * (height + 2.0 * padding)) / (samples * TRIANGLE_AREA)).sqrt();
    let columns = (width / (3.0 * desired)).round().max(1.0) as usize;
    let spacing = if wrap {
        width / (3.0 * columns as f64)
    } else {
        desired
    };
    let rows = (height / (3.0_f64.sqrt() * spacing)).round().max(1.0) as usize;
    let spacing_y = if poles {
        height / (3.0_f64.sqrt() * rows as f64)
    } else {
        spacing
    };
    Ok(WorldShape {
        columns,
        rows,
        spacing,
        spacing_y,
    })
}

#[derive(Default)]
pub struct WorldLatticeOptions {
    pub wrap_x: bool,
    pub close_poles: bool,
    pub coordinate_width: Option<f64>,
    pub area: Option<f64>,
    pub anchor: Option<[f64; 2]>,
}
impl WorldLatticeOptions {
    pub fn build(
        &self,
        bounds: Bounds,
        samples: f64,
        padding: f64,
        covers: impl Fn(f64, f64) -> bool,
    ) -> Result<TriangularLattice, &'static str> {
        self.build_using(bounds, samples, padding, |input| {
            TriangularLattice::new(input, &covers)
        })
    }
    /// Geometry hosts classify one batch for each candidate frame, including the anchor retry.
    pub fn build_batch(
        &self,
        bounds: Bounds,
        samples: f64,
        padding: f64,
        covers: impl Fn(&[atlas_map::Position]) -> Result<Vec<bool>, String>,
    ) -> Result<TriangularLattice, String> {
        self.build_using(bounds, samples, padding, |input| {
            TriangularLattice::classified(input, |points| {
                let points = points
                    .iter()
                    .map(|&[x, y]| atlas_map::Position::xy(x, y))
                    .collect::<Vec<_>>();
                covers(&points)
            })
        })
    }
    fn build_using<E: From<&'static str>>(
        &self,
        bounds: Bounds,
        samples: f64,
        padding: f64,
        create: impl Fn(LatticeInput) -> Result<TriangularLattice, E>,
    ) -> Result<TriangularLattice, E> {
        let shape = world_shape(bounds, samples, padding, self.wrap_x, self.close_poles)?;
        let width = bounds.2 - bounds.0;
        let height = bounds.3 - bounds.1;
        let pad = if self.close_poles { 0.0 } else { padding };
        let mut frame = TriangularFrame {
            width: width + if self.wrap_x { 0.0 } else { 2.0 * pad },
            height: height + 2.0 * pad,
            spacing: shape.spacing,
            spacing_y: shape.spacing_y,
            offset: [0.0, 0.0],
        };
        let build = |frame| {
            create(LatticeInput {
                bounds,
                frame,
                area: self.area.unwrap_or(width * height),
                padding,
                periodic: self.wrap_x.then_some(PeriodicFrame {
                    width,
                    columns: shape.columns,
                    closed_poles: self.close_poles,
                }),
                coordinate_width: self.coordinate_width,
                open_boundary: !self.close_poles,
            })
        };
        let lattice = build(frame)?;
        if !lattice.is_empty() {
            return Ok(lattice);
        }
        let anchor = self
            .anchor
            .unwrap_or([(bounds.0 + bounds.2) / 2.0, (bounds.1 + bounds.3) / 2.0]);
        frame.offset = [
            anchor[0] - (bounds.0 + bounds.2) / 2.0 - frame.spacing,
            anchor[1] - (bounds.1 + bounds.3) / 2.0,
        ];
        let lattice = build(frame)?;
        if lattice.is_empty() {
            return Err("World sampling needs a cell inside its footprint".into());
        }
        Ok(lattice)
    }
}
