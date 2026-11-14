//! Existing effective field traits. Trait authoring and ancestry resolution remain domain inputs.
use super::extrema::{Field, Query};
use crate::{
    scale::{LengthUnit, MapScale},
    spatial::Overlay,
};
use atlas_map::Geometry;
use serde::{Deserialize, Serialize};
use std::io;

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Hard,
    Tendency,
    Derived,
    Exception,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Trait {
    pub field: String,
    pub kind: Kind,
    pub minimum: f64,
    pub maximum: f64,
    pub cause: Option<String>,
    pub scope: Option<Geometry>,
}
impl Trait {
    pub fn validate(&self) -> io::Result<()> {
        if self.field.is_empty()
            || !self.minimum.is_finite()
            || !self.maximum.is_finite()
            || self.minimum > self.maximum
        {
            return Err(io::Error::other(
                "Trait bounds must be finite and ordered on a named field",
            ));
        }
        if self.kind == Kind::Exception
            && (self.cause.as_ref().is_none_or(String::is_empty) || self.scope.is_none())
        {
            return Err(io::Error::other(
                "A causal exception needs a source and footprint",
            ));
        }
        Ok(())
    }
    fn fits(&self, [low, high]: [f64; 2]) -> bool {
        if self.field == "relief" {
            MapScale::metres(high - low, LengthUnit::Native) <= self.maximum
        } else {
            low >= self.minimum && high <= self.maximum
        }
    }
}
pub struct Area<'a> {
    pub footprint: &'a Geometry,
    pub traits: &'a [Trait],
}
impl Query<'_> {
    pub fn validate_traits(
        &mut self,
        area: &Area<'_>,
        field: &Field<'_>,
        channel: &str,
        fact: &str,
    ) -> io::Result<()> {
        for rule in area.traits.iter().filter(|rule| {
            rule.kind == Kind::Hard
                && (rule.field == fact || (rule.field == "relief" && fact == "Elevation"))
        }) {
            let region = self.constrained(area, rule, field)?;
            let range = region
                .as_ref()
                .map(|region| self.range(field, region))
                .transpose()?
                .flatten();
            if range.is_some_and(|range| !rule.fits(range)) {
                return Err(io::Error::other(format!("field_trait_conflict: Edited {channel} values violate the effective {} constraint", rule.field)));
            }
        }
        Ok(())
    }
    fn constrained(
        &self,
        area: &Area<'_>,
        rule: &Trait,
        field: &Field<'_>,
    ) -> io::Result<Option<Geometry>> {
        let mut region = self
            .spatial
            .overlay(
                &self.chart(field, area.footprint)?,
                &self.chart(field, field.footprint)?,
                Overlay::Intersection,
            )
            .map_err(io::Error::other)?;
        if let (Some(shape), Some(scope)) = (&region, &rule.scope) {
            region = self
                .spatial
                .overlay(&self.chart(field, scope)?, shape, Overlay::Intersection)
                .map_err(io::Error::other)?;
        }
        for exception in area
            .traits
            .iter()
            .filter(|e| e.kind == Kind::Exception && e.field == rule.field)
        {
            if let (Some(shape), Some(scope)) = (&region, &exception.scope) {
                region = self
                    .spatial
                    .overlay(shape, &self.chart(field, scope)?, Overlay::Difference)
                    .map_err(io::Error::other)?;
            }
        }
        Ok(region)
    }
}
