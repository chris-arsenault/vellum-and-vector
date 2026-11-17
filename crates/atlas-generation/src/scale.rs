//! One dimensional conversion authority for generated geography.

#[derive(Clone, Copy, Debug)]
pub enum LengthUnit {
    Metre,
    Kilometre,
    Millimetre,
    Foot,
    Native,
}
impl LengthUnit {
    fn factor(self) -> f64 {
        match self {
            Self::Metre => 1.0,
            Self::Kilometre => 1000.0,
            Self::Millimetre => 0.001,
            Self::Foot => 0.3048,
            Self::Native => 1.0 / 1024.0,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct RelativeMeasure {
    fraction: f64,
    dimension: f64,
    exponent: f64,
    unit: LengthUnit,
}
impl RelativeMeasure {
    pub fn new(
        fraction: f64,
        dimension: impl Into<f64>,
        exponent: f64,
        unit: LengthUnit,
    ) -> Result<Self, &'static str> {
        let dimension = dimension.into();
        if !fraction.is_finite()
            || !dimension.is_finite()
            || dimension == 0.0
            || !exponent.is_finite()
            || exponent <= 0.0
        {
            return Err(
                "Declare a finite fraction, nonzero dimension and positive scaling exponent",
            );
        }
        Ok(Self {
            fraction,
            dimension,
            exponent,
            unit,
        })
    }
    pub fn length(fraction: f64) -> Result<Self, &'static str> {
        Self::new(fraction, 1, 1.0, LengthUnit::Metre)
    }
}

/// A resolved value cannot be submitted as a relative declaration a second time.
/// ```compile_fail
/// use atlas_generation::scale::{MapScale, RelativeMeasure};
/// let scale = MapScale::new(400.0, 300.0, 1.0).unwrap();
/// let value = scale.resolve(RelativeMeasure::length(0.1).unwrap()).unwrap();
/// scale.resolve(value);
/// ```
#[derive(Clone, Copy, Debug)]
pub struct ResolvedMeasure {
    value: f64,
    dimension: f64,
}
impl ResolvedMeasure {
    pub fn value(self) -> f64 {
        self.value
    }
    pub fn dimension(self) -> f64 {
        self.dimension
    }
}

// owner-direction(2026-11-12): geology is shares of the map; digital representation precision is fixed
#[derive(Clone, Copy, Debug)]
pub struct MapScale {
    width: f64,
    height: f64,
    cell_span: f64,
    span: f64,
    /// A real-scale map (ADR 0016): physical sizes are real metres, not shares of the map.
    real_size: bool,
}
impl MapScale {
    pub const REFERENCE_WIDTH: f64 = 4_000_000.0;
    pub const REFERENCE_HEIGHT: f64 = 3_000_000.0;
    pub const NATIVE_PER_METRE: f64 = 1024.0;
    pub fn new(width: f64, height: f64, cell_span: f64) -> Result<Self, &'static str> {
        if ![width, height, cell_span]
            .iter()
            .all(|v| v.is_finite() && *v > 0.0)
        {
            return Err("Map dimensions and resolution must be finite and positive");
        }
        let span = (width * height * Self::REFERENCE_WIDTH / Self::REFERENCE_HEIGHT).sqrt();
        if !span.is_finite() {
            return Err("Map dimensions exceed numeric representation");
        }
        Ok(Self {
            width,
            height,
            cell_span,
            span,
            real_size: false,
        })
    }
    /// The same scale on a real-scale map, where a thing's physical size is its real size.
    /// Relative declarations still resolve as before; only sizes declared with a real value
    /// (`field::significance::physical`) read the difference.
    pub fn at_real_size(mut self, real: bool) -> Self {
        self.real_size = real;
        self
    }
    pub fn real_size(&self) -> bool {
        self.real_size
    }
    pub fn resolve(&self, measure: RelativeMeasure) -> Result<ResolvedMeasure, &'static str> {
        let basis =
            Self::REFERENCE_WIDTH * (self.span / Self::REFERENCE_WIDTH).powf(measure.exponent);
        let value = measure.fraction * (basis / measure.unit.factor()).powf(measure.dimension);
        if !value.is_finite() {
            return Err("Resolved dimension exceeds numeric representation");
        }
        Ok(ResolvedMeasure {
            value,
            dimension: measure.dimension,
        })
    }
    pub fn measure_fraction(
        &self,
        value: ResolvedMeasure,
        exponent: f64,
        unit: LengthUnit,
    ) -> Result<f64, &'static str> {
        let basis = self.resolve(RelativeMeasure::new(1.0, value.dimension, exponent, unit)?)?;
        Ok(value.value / basis.value)
    }
    pub fn cells(&self, count: f64) -> f64 {
        count * self.cell_span
    }
    pub fn from_bounds(bounds: [f64; 4], cell_span: f64) -> Result<Self, &'static str> {
        Self::new(bounds[2] - bounds[0], bounds[3] - bounds[1], cell_span)
    }
    pub fn from_cells(bounds: [f64; 4], cells: f64) -> Result<Self, &'static str> {
        if !cells.is_finite() || cells <= 0.0 {
            return Err("Cell count must be positive");
        }
        let width = bounds[2] - bounds[0];
        let height = bounds[3] - bounds[1];
        Self::new(width, height, (width * height / cells).sqrt())
    }
    pub fn reference(cell_span: f64) -> Result<Self, &'static str> {
        Self::new(Self::REFERENCE_WIDTH, Self::REFERENCE_HEIGHT, cell_span)
    }
    pub fn cell_count(&self, length: f64) -> f64 {
        length / self.cell_span
    }
    pub fn cell_area(&self, count: f64) -> f64 {
        count * self.cell_span.powi(2)
    }
    pub fn resolution(&self, cells: f64) -> Result<(f64, f64), &'static str> {
        if !cells.is_finite() || cells <= 0.0 {
            return Err("Cell count must be positive");
        }
        let area = self.width * self.height / cells;
        Ok((area, area.sqrt()))
    }
    pub fn supported(&self, length: f64, cells: f64) -> f64 {
        length.max(self.cells(cells))
    }
    pub fn metres(value: f64, unit: LengthUnit) -> f64 {
        value * unit.factor()
    }
    pub fn in_units(metres: f64, unit: LengthUnit) -> f64 {
        metres / unit.factor()
    }
    pub fn native(metres: f64) -> f64 {
        (metres * Self::NATIVE_PER_METRE).round()
    }
    pub fn area_units(value: f64, from: AreaUnit, to: AreaUnit) -> f64 {
        value * from.factor() / to.factor()
    }
}
#[derive(Clone, Copy)]
pub enum AreaUnit {
    SquareMetre,
    SquareKilometre,
}
impl AreaUnit {
    fn factor(self) -> f64 {
        match self {
            Self::SquareMetre => 1.0,
            Self::SquareKilometre => 1_000_000.0,
        }
    }
}
