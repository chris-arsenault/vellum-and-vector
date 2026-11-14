use super::{
    catalogue::{Kind, Landmark},
    path::Path,
};
use crate::{
    field::{shared::Scalar, Field},
    lattice::sampling::Sampler,
    scale::{LengthUnit, MapScale},
    spatial::SpatialKernel,
    tectonics::{fracture::Plume, integration},
};
use atlas_map::Geometry;
use std::io;
pub struct Placed<'a> {
    pub landmark: &'a Landmark,
    pub center: [f64; 2],
    pub path: Vec<[f64; 2]>,
}
pub struct Tracking<'a> {
    pub drift: &'a [f64],
    pub epoch: usize,
    pub plumes: &'a [Plume],
    pub kernel: &'a dyn SpatialKernel,
}
pub fn track(
    field: &Field,
    points: &mut [[f64; 2]],
    input: &Tracking<'_>,
    forward: bool,
) -> io::Result<()> {
    let remaining = input
        .drift
        .iter()
        .skip(input.epoch.saturating_add(1))
        .copied()
        .filter(|&d| d > 0.0)
        .collect::<Vec<_>>();
    if remaining.is_empty() {
        return Ok(());
    }
    if let Some(state) = &field.tectonics {
        let frames = integration::forecast_frames(
            &field.mesh,
            field.scale,
            input.kernel,
            state,
            &remaining,
            input.plumes,
        )
        .map_err(io::Error::other)?;
        let indexed = frames
            .iter()
            .map(|frame| {
                frame
                    .indexed(&field.mesh, input.kernel)
                    .map_err(io::Error::other)
            })
            .collect::<io::Result<Vec<_>>>()?;
        for point in points {
            if forward {
                for frame in &indexed {
                    *point = frame
                        .forward(&field.mesh, *point)
                        .map_err(io::Error::other)?;
                }
            } else {
                for frame in indexed.iter().rev() {
                    *point = frame
                        .inverse(&field.mesh, *point)
                        .map_err(io::Error::other)?;
                }
            }
        }
        return Ok(());
    }
    let vx = field.shared.scalar(Scalar::CrustMotionX);
    let vy = field.shared.scalar(Scalar::CrustMotionY);
    let mut x = Sampler::new(&field.mesh);
    let mut y = Sampler::new(&field.mesh);
    let sign = if forward { 1.0 } else { -1.0 };
    let steps = if forward {
        remaining
    } else {
        remaining.into_iter().rev().collect()
    };
    for point in points {
        for &step in &steps {
            *point = field.mesh.point(
                point[0] + sign * x.sample(*point, |cell| vx.get(cell))? / 1000.0 * step,
                point[1] + sign * y.sample(*point, |cell| vy.get(cell))? / 1000.0 * step,
            );
        }
    }
    Ok(())
}
pub fn place<'a>(
    field: &Field,
    landmark: &'a Landmark,
    tracking: Option<&Tracking<'_>>,
) -> io::Result<Option<Placed<'a>>> {
    let coordinates = match &landmark.geometry {
        Geometry::Point { coordinates } => vec![*coordinates],
        Geometry::LineString { coordinates } if coordinates.len() >= 2 => coordinates.clone(),
        _ => return Ok(None),
    };
    let origin = field.mesh.origin();
    let mut path = coordinates
        .into_iter()
        .map(|p| {
            let p = p.coordinates();
            field.mesh.point(p[0] - origin[0], p[1] - origin[1])
        })
        .collect::<Vec<_>>();
    if let Some(tracking) = tracking {
        track(field, &mut path, tracking, false)?;
    }
    Ok(Some(Placed {
        landmark,
        center: path[0],
        path,
    }))
}
pub fn realized(field: &Field, placed: &Placed<'_>) -> bool {
    let p = &placed.landmark.parameters;
    let span = field.scale.cells(1.0);
    if placed.landmark.kind.system().is_some() {
        return MapScale::metres(p["reach"], LengthUnit::Kilometre) >= span;
    }
    match placed.landmark.kind {
        Kind::VolcanicMountain | Kind::ResistantMountain => {
            MapScale::metres(p["baseRadius"], LengthUnit::Kilometre) * 2.0 >= field.scale.cells(2.0)
        }
        Kind::Canyon | Kind::Escarpment => Path::new(&field.mesh, &placed.path).total >= 2.0 * span,
        Kind::DomeRing => {
            MapScale::metres(p["diameter"], LengthUnit::Kilometre) >= 2.0 * span
                && MapScale::metres(p["diameter"], LengthUnit::Kilometre) / (2.0 * p["ringCount"])
                    >= span
        }
        Kind::ImpactRing => MapScale::metres(p["diameter"], LengthUnit::Kilometre) >= 2.0 * span,
        _ => false,
    }
}
