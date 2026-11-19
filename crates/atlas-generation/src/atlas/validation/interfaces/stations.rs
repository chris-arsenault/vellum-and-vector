use super::Crossing;
use crate::{
    features::{context::Context, line_profile::Line, network_parts::line_parts, Feature, State},
    spatial::SpatialKernel,
};
use atlas_map::{Geometry, Position};
use std::io;

pub(super) struct Query<'a> {
    pub context: &'a Context,
    pub spatial: &'a dyn SpatialKernel,
    pub precision: f64,
}
pub(super) fn validate(
    query: &Query<'_>,
    feature: &Feature,
    geometry: &Geometry,
    footprint: &Geometry,
    expected: &[&Crossing],
) -> io::Result<()> {
    let Query {
        spatial, precision, ..
    } = *query;
    let actual = spatial
        .crossings(geometry, footprint)
        .map_err(io::Error::other)?;
    if expected.len() != actual.len()
        || expected.iter().any(|crossing| {
            !actual.iter().any(|point| {
                let [x, y, _] = point.coordinates();
                (crossing.point.x - x).hypot(crossing.point.y - y) <= precision
            })
        })
    {
        return Err(io::Error::other("Keep contracted crossing anchors; use boundary reconciliation to change their locations"));
    }
    if feature.kind != "river" || expected.is_empty() {
        return Ok(());
    }
    let line = Line::new(geometry, spatial)?;
    for crossing in expected {
        let point = crossing.position();
        if let Some(direction) = &crossing.direction {
            if direction != "undirected"
                && line.direction(footprint, point, precision)? != direction
            {
                return Err(io::Error::other(
                    "A river keeps its contracted inlet and outlet direction",
                ));
            }
        }
        let elevation =
            station(query, feature, geometry, "elevations", point)?.ok_or_else(|| {
                io::Error::other(
                    "A river edit needs a resolved elevation profile at its interfaces",
                )
            })?;
        if crossing.elevation_known != Some(false)
            && (elevation - crossing.elevation).abs() > precision
        {
            return Err(io::Error::other(
                "The edited river must retain its contracted boundary elevation",
            ));
        }
        flow(
            station(query, feature, geometry, "discharges", point)?,
            crossing,
        )?;
    }
    Ok(())
}
fn flow(value: Option<f64>, expected: &Crossing) -> io::Result<()> {
    if expected.flow_known == Some(false) {
        return Ok(());
    }
    let minimum = expected
        .flow_minimum
        .unwrap_or((expected.flow - expected.flow_uncertainty.unwrap_or(0.0)).max(0.0));
    let maximum = expected
        .flow_maximum
        .unwrap_or(expected.flow + expected.flow_uncertainty.unwrap_or(0.0));
    let rounding = 8.0 * f64::EPSILON * 1.0_f64.max(minimum.abs()).max(maximum.abs());
    if value.is_none_or(|value| value < minimum - rounding || value > maximum + rounding) {
        return Err(io::Error::other(
            "The edited river must retain its contracted discharge envelope",
        ));
    }
    Ok(())
}
fn station(
    query: &Query<'_>,
    feature: &Feature,
    geometry: &Geometry,
    channel: &str,
    point: Position,
) -> io::Result<Option<f64>> {
    let Query {
        context,
        spatial,
        precision,
    } = *query;
    let count: usize = line_parts(geometry).iter().map(|part| part.len()).sum();
    if feature
        .attributes
        .get(channel)
        .and_then(|value| value.as_array())
        .is_some_and(|values| values.len() == count)
    {
        return Line::new(geometry, spatial)?.value(&feature.attributes, channel, point);
    }
    let mut details = Vec::new();
    for (&id, detail) in &feature.detail {
        if detail.needs_reconciliation
            || detail.state == State::Stale
            || detail.attributes.is_none()
        {
            continue;
        }
        if spatial
            .distance(&detail.geometry, &Geometry::Point { coordinates: point })
            .map_err(io::Error::other)?
            <= 2.0 * precision
        {
            details.push((context.area(id).map_err(io::Error::other)?.profile, detail));
        }
    }
    // hpc-exempt: sparse authored representations, ordered by their map profile.
    details.sort_by_key(|(profile, _)| std::cmp::Reverse(*profile));
    for (_, detail) in details {
        if let Some(value) = Line::new(&detail.geometry, spatial)?.value(
            detail.attributes.as_ref().expect("selected attributes"),
            channel,
            point,
        )? {
            return Ok(Some(value));
        }
    }
    Line::new(&feature.geometry, spatial)?.value(&feature.attributes, channel, point)
}
