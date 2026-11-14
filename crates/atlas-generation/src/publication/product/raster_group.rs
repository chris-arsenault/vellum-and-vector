//! Separate overlay identities share one planar GIS asset when their geography agrees.
use crate::{
    publication::{
        raster::{MapRaster, RasterPlane, Resampling},
        upload::RasterPublication,
    },
    storage::Coverage,
};
use atlas_map::RasterSource;
use std::io;

pub fn append(
    group: &mut Option<MapRaster>,
    channel: &str,
    publication: RasterPublication,
    storage: &mut Coverage,
) -> io::Result<(RasterSource, Coverage)> {
    let mut source = publication.source();
    let (raster, owner) = publication.into_raster()?;
    let group = group.get_or_insert_with(|| MapRaster {
        grid: raster.grid,
        coverage: storage.scratch(raster.coverage.len(), 0.0),
        planes: Vec::new(),
    });
    if group.grid != raster.grid {
        return Err(io::Error::other(
            "Grouped overlays must share their map pixel grid",
        ));
    }
    let offset = group.planes.len();
    source.band_indices = (offset + 1..=offset + source.bands.len())
        .map(|index| u16::try_from(index).map_err(io::Error::other))
        .collect::<io::Result<_>>()?;
    for i in 0..group.coverage.len() {
        group
            .coverage
            .set(i, group.coverage.get(i)?.max(raster.coverage.get(i)?))?;
    }
    let mut planes = raster.planes;
    planes.push(RasterPlane {
        definition: source.bands.last().expect("Publication coverage").clone(),
        resampling: Resampling::Mean,
        values: raster.coverage,
    });
    for plane in &mut planes {
        plane.definition.id = format!("{channel}:{}", plane.definition.id);
    }
    group.planes.extend(planes);
    Ok((source, owner))
}
