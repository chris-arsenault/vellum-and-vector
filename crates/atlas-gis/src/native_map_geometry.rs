use crate::{geometry::NativeGeos, map_store::EncodedGeometry};
use atlas_map::{spatial::SpatialKernel, Geometry};
use geos::{Geom, Geometry as Native};
use std::io;
#[derive(Clone)]
pub struct NativeMapGeometry;
impl NativeMapGeometry {
    pub fn encode(&self, shape: &Geometry, precision: f64) -> io::Result<EncodedGeometry> {
        let kernel = NativeGeos::new(precision).map_err(io::Error::other)?;
        let geometry = kernel.read_exact(shape).map_err(io::Error::other)?;
        let [w, s, e, n]: [f64; 4] = geometry
            .get_extent()
            .map_err(io::Error::other)?
            .try_into()
            .map_err(|_| io::Error::other("Invalid geometry extent"))?;
        Ok(EncodedGeometry {
            bytes: geometry.to_wkb().map_err(io::Error::other)?,
            bounds: atlas_map::Bounds(w, s, e, n),
        })
    }
    pub fn decode(&self, bytes: &[u8]) -> io::Result<Geometry> {
        NativeGeos::json(Native::new_from_wkb(bytes).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .ok_or_else(|| io::Error::other("Empty stored map geometry"))
    }
    pub fn spatial(&self, precision: f64) -> io::Result<Box<dyn SpatialKernel + '_>> {
        Ok(Box::new(
            NativeGeos::new(precision).map_err(io::Error::other)?,
        ))
    }
}
