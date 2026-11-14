use super::{RelativeOverrides, ResolvedSettings, ScaleDefinition};
use crate::{
    atlas::parameters::AtlasParameters,
    scale::{MapScale, RelativeMeasure},
};
use serde_json::Value;

impl MapScale {
    pub fn atlas_profile(
        &self,
        parameters: &AtlasParameters,
        definition: &ScaleDefinition,
        overrides: &RelativeOverrides,
    ) -> Result<ResolvedSettings, &'static str> {
        parameters.validate()?;
        let mut profile = self.resolve_settings(definition, overrides)?;
        profile.atlas_controls(parameters, self)?;
        Ok(profile)
    }
}
impl ResolvedSettings {
    pub fn atlas_frame(mut self, bounds: [f64; 4], boundary: f64) -> Result<Self, &'static str> {
        self.set("MapBoundary", boundary)?;
        self.set("WrapLongitude", f64::from(boundary == 1.0))?;
        self.0["WorldExtentX"] = serde_json::json!([bounds[0], bounds[2]]);
        self.0["WorldExtentY"] = serde_json::json!([bounds[1], bounds[3]]);
        Ok(self)
    }
    pub fn regional_profile(
        &self,
        parent_span: f64,
        scale: MapScale,
    ) -> Result<Self, &'static str> {
        let mut profile = self.clone();
        let length = |fraction| {
            Ok::<f64, &'static str>(scale.resolve(RelativeMeasure::length(fraction)?)?.value())
        };
        let relief = scale.supported(0.45 * parent_span, 2.0);
        for (key, value) in [
            ("ReliefRadius", relief),
            ("LandformNeighborhoodRadius", relief),
            ("MountainElevation", length(0.000075)?),
            ("HillElevation", length(0.000075)?),
            ("MountainLocalRelief", length(0.0000375)?),
            ("RidgeElevationThreshold", length(0.000075)?),
            ("GorgeMinimumSlope", 0.03),
            ("GorgeMinimumIncision", length(0.000015)?),
            ("FjordMinimumGlacialErosion", length(0.0000075)?),
            ("RangeMinimumArea", scale.cell_area(4.0)),
            ("PlainSlopeThreshold", 0.012),
            ("WindTerrainLength", scale.supported(0.5 * parent_span, 2.0)),
            ("WindBlockingHeight", length(0.000075)?),
        ] {
            profile.set(key, value)?;
        }
        Ok(profile)
    }
    fn number(&self, key: &str) -> Result<f64, &'static str> {
        self.0
            .get(key)
            .and_then(Value::as_f64)
            .ok_or("Physical profile is missing a numeric setting")
    }
    fn set(&mut self, key: &str, value: f64) -> Result<(), &'static str> {
        if !value.is_finite() {
            return Err("Physical setting exceeds numeric representation");
        }
        let target = self
            .0
            .get_mut(key)
            .ok_or("Physical profile is missing a setting")?;
        *target = if value.fract() == 0.0 && value >= i64::MIN as f64 && value < i64::MAX as f64 {
            Value::from(value as i64)
        } else {
            Value::from(value)
        };
        Ok(())
    }
    fn multiply(&mut self, key: &str, factor: f64) -> Result<(), &'static str> {
        self.set(key, self.number(key)? * factor)
    }
    pub fn epoch_profile(&self, impacts: f64, volcanism: f64) -> Result<Self, &'static str> {
        let mut profile = self.clone();
        profile.set(
            "ImpactCraterCount",
            (profile.number("ImpactCraterCount")? * impacts).round(),
        )?;
        profile.multiply("VolcanicConeHeight", volcanism)?;
        Ok(profile)
    }
    fn atlas_controls(
        &mut self,
        p: &AtlasParameters,
        scale: &MapScale,
    ) -> Result<(), &'static str> {
        for (key, value) in [
            ("ContinentalAssemblyCount", p.continents),
            ("OceanicPlateCount", p.oceanic_plates),
            ("TectonicProvinceCount", p.provinces),
            ("ContinentalCrustFraction", p.continental_crust_fraction),
            ("TemperatureBaseline", 300.0 + p.temperature * 10.0),
            ("LatitudeSouth", p.south_latitude),
            ("LatitudeNorth", p.north_latitude),
            ("LatitudeProjection", p.latitude_projection),
            ("MapBoundary", p.map_boundary),
            ("WrapLongitude", f64::from(p.map_boundary == 1.0)),
            (
                "SeaLevel",
                scale
                    .resolve(RelativeMeasure::length(p.sea_level)?)?
                    .value()
                    / self.number("ElevationScale")?,
            ),
            ("ImpactCraterCount", p.impacts),
            ("HeartWarmthStrength", 0.0),
            ("WarmthPocketCount", 0.0),
            (
                "GeothermalSurfaceThreshold",
                self.number("GeothermalVentThreshold")?,
            ),
            ("GeothermalTemperatureStrength", 100.0),
            ("OceanCurrentTemperatureStrength", 0.0),
            ("OceanCurrentWarmthStrength", 0.0),
            ("SeaIceCurrentResistance", 20.0),
            ("SeaIceWaveResistance", 20.0),
            ("SeaIceSuitabilityVariation", 30.0),
        ] {
            self.set(key, value)?;
        }
        let ocean = self
            .0
            .pointer_mut("/QualityTargets/OceanCoverage/target")
            .ok_or("Physical profile is missing its ocean coverage target")?;
        *ocean = Value::from(1.0 - p.land_fraction);
        for (key, factor) in [
            ("PrecipitationBaseline", p.rainfall),
            ("ColumnSaturation", p.rainfall),
            ("FluvialErosionRate", p.erosion),
            ("ImpactMinimumRadius", p.impact_size),
            ("ImpactMaximumRadius", p.impact_size),
            ("VolcanicConeHeight", p.volcanism),
            ("PlateDriftPerMyr", p.plate_drift),
            ("GlacialCutPerSpeed", p.glaciers),
            ("CoastalErosionStrength", p.coastal_erosion),
        ] {
            self.multiply(key, factor)?;
        }
        Ok(())
    }
}
