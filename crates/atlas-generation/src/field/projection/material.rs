//! The two current cartographic material classifications, derived from their actual owners.
use super::super::{
    shared::{CellCode as C, Scalar as S},
    Field,
};
use crate::{
    rock::{
        catalogue,
        ground::{query::GroundQuery, GroundField as G},
        material::MaterialLayer,
    },
    scale::{LengthUnit, MapScale, RelativeMeasure},
    settlement::removal::Facet,
};
use std::io;

pub fn length(field: &Field, fraction: f64) -> io::Result<f64> {
    field
        .scale()
        .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
        .map(|value| value.value())
        .map_err(io::Error::other)
}
pub struct Materials<'a> {
    field: &'a Field,
    full_soil: f64,
    ice: f64,
    shelf: f64,
    exposed: GroundQuery<'static, Option<MaterialLayer>>,
}
impl<'a> Materials<'a> {
    pub fn new(field: &'a Field) -> io::Result<Self> {
        let mut exposed = GroundQuery::new(None);
        exposed.loose = Some(Box::new(|_, layer, _| Some(layer.material.clone())));
        exposed.rock = Some(Box::new(|cover, layer, _| {
            cover.or_else(|| Some(layer.material.clone()))
        }));
        Ok(Self {
            field,
            full_soil: length(field, 0.00000025)?,
            ice: length(field, 0.000075)?,
            shelf: MapScale::native(length(field, 0.00003125)?),
            exposed,
        })
    }
    pub fn surface(&self, cell: usize) -> io::Result<f64> {
        if self.field.shared.scalar(S::IceThickness).get(cell)? > 0.0 {
            return Ok(catalogue::GLACIER_ICE as f64);
        }
        if self.field.water().column.kind.get(cell)? != 0 {
            return Ok(catalogue::KIND_COUNT as f64);
        }
        let ground = self.field.ground();
        let soil = (ground.view(G::SoilDepth).get(cell)? / self.full_soil).clamp(0.0, 1.0);
        let mut shares = [0.0; catalogue::KIND_COUNT];
        shares[catalogue::SOIL] = soil;
        for facet in Facet::ALL {
            if let Some(material) = ground.fold(cell, &self.exposed, Some(facet))? {
                let share = ground.share(cell, facet)? * (1.0 - soil);
                shares[material.kind] += share * (1.0 - material.secondary_share);
                shares[material.secondary_kind] += share * material.secondary_share;
            }
        }
        let mut dominant = catalogue::STRATA;
        for code in 0..shares.len() {
            if shares[code] > shares[dominant] {
                dominant = code;
            }
        }
        Ok(dominant as f64)
    }
    pub fn physical(&self, cell: usize) -> io::Result<f64> {
        let scalar = |name| self.field.shared.scalar(name).get(cell);
        let code = |name| self.field.shared.code(name).get(cell);
        if self.field.water().column.kind.get(cell)? == 1 {
            if code(C::BathymetricZoneCodes)? == 4 {
                return Ok(7.0);
            }
            if self
                .field
                .water()
                .column
                .store(crate::water::column::Store::Standing)
                .contents()
                .get(cell)?
                <= self.shelf
                && scalar(S::Temperature)? >= 300.0
                && scalar(S::Geothermal)? >= 150.0
            {
                return Ok(8.0);
            }
            return Ok(6.0);
        }
        if scalar(S::DeltaIntensity)? > 0.0 || scalar(S::FloodplainIntensity)? > 0.0 {
            return Ok(3.0);
        }
        let landform = code(C::LandformCodes)?;
        if landform == 12 {
            return Ok(10.0);
        }
        if scalar(S::Geothermal)? >= 760.0 {
            return Ok(9.0);
        }
        if scalar(S::IceThickness)? >= self.ice {
            return Ok(5.0);
        }
        if matches!(landform, 16 | 17) {
            return Ok(0.0);
        }
        if matches!(landform, 5 | 6) {
            return Ok(if scalar(S::Slope)? >= 0.0085 {
                0.0
            } else {
                1.0
            });
        }
        let moisture = scalar(S::Moisture)?;
        if scalar(S::Temperature)? <= 250.0 {
            return Ok(if moisture >= 560.0 { 4.0 } else { 2.0 });
        }
        Ok(if moisture >= 330.0 { 3.0 } else { 2.0 })
    }
}
pub fn carbonate(field: &Field, cell: usize, volcanic_depth: f64) -> io::Result<f64> {
    Ok(
        field.ground().view(G::CrustContinentalFraction).get(cell)? / 1000.0
            * (1.0
                - (MapScale::metres(
                    field
                        .shared
                        .scalar(S::VolcanicConstructionHistory)
                        .get(cell)?,
                    LengthUnit::Native,
                ) / volcanic_depth)
                    .min(1.0)),
    )
}
