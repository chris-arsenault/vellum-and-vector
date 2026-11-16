//! One fixed material schema bound to typed columns; read views never expose owner writers.
use super::{material::MaterialLayer, MaterialFacts};
use crate::storage::{Band, Coverage, ReadBand, ReadValues};
use std::io;

#[derive(Clone, Copy)]
#[repr(usize)]
pub enum MaterialScalar {
    Depth,
    SecondaryShare,
    Strength,
    Damage,
    GrainX,
    GrainY,
    BedSlopeX,
    BedSlopeY,
    Deposited,
    Consolidation,
    FormedMin,
    FormedMax,
    Altered,
}
const SCALARS: usize = 13;
fn check_cell(cell: usize, count: usize) -> io::Result<()> {
    if cell >= count {
        return Err(io::Error::other("Material cell outside layer"));
    }
    Ok(())
}
impl MaterialScalar {
    pub const ALL: [Self; SCALARS] = [
        Self::Depth,
        Self::SecondaryShare,
        Self::Strength,
        Self::Damage,
        Self::GrainX,
        Self::GrainY,
        Self::BedSlopeX,
        Self::BedSlopeY,
        Self::Deposited,
        Self::Consolidation,
        Self::FormedMin,
        Self::FormedMax,
        Self::Altered,
    ];
    pub fn name(self) -> &'static str {
        [
            "Depth",
            "SecondaryShare",
            "Strength",
            "Damage",
            "GrainX",
            "GrainY",
            "BedSlopeX",
            "BedSlopeY",
            "Deposited",
            "Consolidation",
            "FormedMin",
            "FormedMax",
            "Altered",
        ][self as usize]
    }
}
pub struct LayerBands {
    kind: Band<u32>,
    secondary_kind: Band<u32>,
    mixed: Band<u32>,
    scalars: Band<f64>,
    count: usize,
}

/// Operation-scoped borrows of the owner's material schema.
pub(super) struct LayerValues<'a> {
    kind: ReadValues<'a, u32>,
    secondary_kind: ReadValues<'a, u32>,
    mixed: ReadValues<'a, u32>,
    scalars: ReadValues<'a, f64>,
    count: usize,
}
impl LayerValues<'_> {
    pub(super) fn depth(&self, cell: usize) -> io::Result<f64> {
        check_cell(cell, self.count)?;
        self.scalars.get(cell)
    }
    pub(super) fn read(
        &self,
        cell: usize,
        catalogue: &[MaterialFacts],
    ) -> io::Result<MaterialLayer> {
        with_catalogue(
            read_material(
                self.kind.get(cell)?,
                self.secondary_kind.get(cell)?,
                self.mixed.get(cell)?,
                |property| self.scalars.get(property as usize * self.count + cell),
            )?,
            catalogue,
        )
    }
}

/// Only detached slabs or immutable band capabilities leave the material owner.
/// ```compile_fail
/// use atlas_generation::rock::layer_bands::ReadLayerBands;
/// fn bypass(view:ReadLayerBands) {view.kind.set(0,3);}
/// ```
#[derive(Clone)]
pub struct ReadLayerBands {
    kind: ReadBand<u32>,
    secondary_kind: ReadBand<u32>,
    mixed: ReadBand<u32>,
    scalars: [ReadBand<f64>; SCALARS],
}
impl crate::execution::QueryValue for ReadLayerBands {}

impl LayerBands {
    /// Surface projection needs neither chronology nor detached cargo parcels.
    pub(super) fn surface_material(
        &self,
        cell: usize,
        catalogue: &[MaterialFacts],
    ) -> io::Result<MaterialLayer> {
        let scalars = self.scalars.read_values()?;
        let get = |property: MaterialScalar| scalars.get(property as usize * self.count + cell);
        with_catalogue(
            MaterialLayer {
                kind: self.kind.get(cell)? as usize,
                secondary_kind: self.secondary_kind.get(cell)? as usize,
                strength: get(MaterialScalar::Strength)?,
                consolidation: get(MaterialScalar::Consolidation)?,
                grain_x: get(MaterialScalar::GrainX)?,
                grain_y: get(MaterialScalar::GrainY)?,
                ..MaterialLayer::default()
            },
            catalogue,
        )
    }
    pub(super) fn transform(&mut self, cell: usize, f: [f64; 4]) -> io::Result<()> {
        use super::ground::deformation::{deform_fabric, deform_slope};
        check_cell(cell, self.count)?;
        let mut scalars = self.scalars.write_values()?;
        for (x, y, transform) in [
            (
                MaterialScalar::GrainX,
                MaterialScalar::GrainY,
                deform_fabric as fn(f64, f64, [f64; 4]) -> [f64; 2],
            ),
            (
                MaterialScalar::BedSlopeX,
                MaterialScalar::BedSlopeY,
                deform_slope,
            ),
        ] {
            let [vx, vy] = transform(
                scalars.get(x as usize * self.count + cell)?,
                scalars.get(y as usize * self.count + cell)?,
                f,
            );
            scalars.set(x as usize * self.count + cell, vx)?;
            scalars.set(y as usize * self.count + cell, vy)?;
        }
        Ok(())
    }
    pub(super) fn tilt_field(
        &mut self,
        gradients: &[[f64; 2]],
        includes: impl Fn(usize) -> io::Result<bool>,
        epoch: f64,
        revisions: &mut crate::storage::WriteValues<'_, f64>,
    ) -> io::Result<()> {
        if gradients.len() != self.count {
            return Err(io::Error::other("Material gradients must cover the layer"));
        }
        let mut scalars = self.scalars.write_values()?;
        let x_at = MaterialScalar::BedSlopeX as usize * self.count;
        let y_at = MaterialScalar::BedSlopeY as usize * self.count;
        let age_at = MaterialScalar::Altered as usize * self.count;
        for (cell, &[x, y]) in gradients.iter().enumerate() {
            if (x == 0.0 && y == 0.0) || !includes(cell)? || scalars.get(cell)? <= 0.0 {
                continue;
            }
            scalars.set(x_at + cell, scalars.get(x_at + cell)? + x)?;
            scalars.set(y_at + cell, scalars.get(y_at + cell)? + y)?;
            scalars.set(age_at + cell, epoch)?;
            revisions.set(cell, revisions.get(cell)? + 1.0)?;
        }
        Ok(())
    }
    pub(super) fn read_values(&self) -> io::Result<LayerValues<'_>> {
        Ok(LayerValues {
            kind: self.kind.read_values()?,
            secondary_kind: self.secondary_kind.read_values()?,
            mixed: self.mixed.read_values()?,
            scalars: self.scalars.read_values()?,
            count: self.count,
        })
    }
    pub(super) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> io::Result<()> {
        archive.band("kind", &mut self.kind)?;
        archive.band("secondary-kind", &mut self.secondary_kind)?;
        archive.band("mixed", &mut self.mixed)?;
        archive.band("packed-material-scalars", &mut self.scalars)
    }
    pub(super) fn depth(&self, cell: usize) -> io::Result<f64> {
        check_cell(cell, self.count)?;
        self.scalars.get(cell)
    }
    pub(super) fn read(
        &self,
        cell: usize,
        catalogue: &[MaterialFacts],
    ) -> io::Result<MaterialLayer> {
        with_catalogue(self.read_raw(cell)?, catalogue)
    }
    pub(super) fn read_raw(&self, cell: usize) -> io::Result<MaterialLayer> {
        let scalars = self.scalars.read_values()?;
        read_material(
            self.kind.get(cell)?,
            self.secondary_kind.get(cell)?,
            self.mixed.get(cell)?,
            |property| scalars.get(property as usize * self.count + cell),
        )
    }
    pub fn new(coverage: &mut Coverage) -> Self {
        let count = coverage.len();
        let mut scalars = coverage.scratch(
            count
                .checked_mul(SCALARS)
                .expect("Material scalar address overflow"),
            0.0,
        );
        scalars.retain();
        Self {
            kind: coverage.allocate(0),
            secondary_kind: coverage.allocate(0),
            mixed: coverage.allocate(0),
            scalars,
            count,
        }
    }
    pub fn read_only(&self) -> ReadLayerBands {
        ReadLayerBands {
            kind: self.kind.read_only(),
            secondary_kind: self.secondary_kind.read_only(),
            mixed: self.mixed.read_only(),
            scalars: std::array::from_fn(|i| {
                self.scalars
                    .read_only()
                    .slice(i * self.count..(i + 1) * self.count)
                    .expect("Material channel range")
            }),
        }
    }
    pub(super) fn set_depth(&mut self, cell: usize, depth: f64) -> io::Result<()> {
        check_cell(cell, self.count)?;
        self.scalars.set(cell, depth)
    }
    /// A field constructor hands this capability to its owner, never to the public field view.
    pub fn write(&mut self, cell: usize, material: &MaterialLayer) -> io::Result<()> {
        check_cell(cell, self.count)?;
        let kind = u32::try_from(material.kind)
            .map_err(|_| io::Error::other("Material code exceeds its representation"))?;
        let secondary = u32::try_from(material.secondary_kind)
            .map_err(|_| io::Error::other("Material code exceeds its representation"))?;
        if !material.mixed.is_finite()
            || material.mixed < 0.0
            || material.mixed > u32::MAX as f64
            || material.mixed.fract() != 0.0
        {
            return Err(io::Error::other(
                "Material mixture flag requires an unsigned integer representation",
            ));
        }
        let values = [
            material.depth,
            material.secondary_share,
            material.strength,
            material.damage,
            material.grain_x,
            material.grain_y,
            material.bed_slope_x,
            material.bed_slope_y,
            material.deposited,
            material.consolidation,
            material.formed_min,
            material.formed_max,
            material.altered,
        ];
        let mut scalars = self.scalars.write_values()?;
        for (property, value) in values.into_iter().enumerate() {
            scalars.set(property * self.count + cell, value)?;
        }
        self.kind.set(cell, kind)?;
        self.secondary_kind.set(cell, secondary)?;
        self.mixed.set(cell, material.mixed as u32)
    }
    pub fn snapshot(&self, coverage: &mut Coverage) -> io::Result<Self> {
        Ok(Self {
            kind: coverage.copy_band(&self.kind)?,
            secondary_kind: coverage.copy_band(&self.secondary_kind)?,
            mixed: coverage.copy_band(&self.mixed)?,
            scalars: coverage.copy_band(&self.scalars)?,
            count: self.count,
        })
    }
}
impl ReadLayerBands {
    pub fn kind(&self) -> ReadBand<u32> {
        self.kind.clone()
    }
    pub fn secondary_kind(&self) -> ReadBand<u32> {
        self.secondary_kind.clone()
    }
    pub fn mixed(&self) -> ReadBand<u32> {
        self.mixed.clone()
    }
    pub fn scalar(&self, property: MaterialScalar) -> ReadBand<f64> {
        self.scalars[property as usize].clone()
    }
    pub fn read(&self, cell: usize, catalogue: &[MaterialFacts]) -> io::Result<MaterialLayer> {
        with_catalogue(self.read_raw(cell)?, catalogue)
    }
    /// Loads retain zero values in empty slots; catalogue defaults apply only to rock reads.
    pub fn read_raw(&self, cell: usize) -> io::Result<MaterialLayer> {
        read_material(
            self.kind.get(cell)?,
            self.secondary_kind.get(cell)?,
            self.mixed.get(cell)?,
            |property| self.scalars[property as usize].get(cell),
        )
    }
}
fn with_catalogue(
    mut layer: MaterialLayer,
    catalogue: &[MaterialFacts],
) -> io::Result<MaterialLayer> {
    if layer.kind >= catalogue.len() || layer.secondary_kind >= catalogue.len() {
        return Err(io::Error::other(
            "Material constituents must resolve in the owning catalogue",
        ));
    }
    if layer.strength == 0.0 {
        layer.strength = catalogue[layer.kind].resistance;
    }
    Ok(layer)
}
fn read_material(
    kind: u32,
    secondary_kind: u32,
    mixed: u32,
    get: impl Fn(MaterialScalar) -> io::Result<f64>,
) -> io::Result<MaterialLayer> {
    Ok(MaterialLayer {
        kind: kind as usize,
        secondary_kind: secondary_kind as usize,
        depth: get(MaterialScalar::Depth)?,
        secondary_share: get(MaterialScalar::SecondaryShare)?,
        strength: get(MaterialScalar::Strength)?,
        damage: get(MaterialScalar::Damage)?,
        grain_x: get(MaterialScalar::GrainX)?,
        grain_y: get(MaterialScalar::GrainY)?,
        bed_slope_x: get(MaterialScalar::BedSlopeX)?,
        bed_slope_y: get(MaterialScalar::BedSlopeY)?,
        deposited: get(MaterialScalar::Deposited)?,
        consolidation: get(MaterialScalar::Consolidation)?,
        formed_min: get(MaterialScalar::FormedMin)?,
        formed_max: get(MaterialScalar::FormedMax)?,
        altered: get(MaterialScalar::Altered)?,
        mixed: mixed as f64,
        cargo: None,
    })
}
