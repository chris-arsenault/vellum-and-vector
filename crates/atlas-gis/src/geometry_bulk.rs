use crate::geometry::NativeGeos;
use atlas_map::spatial::{Overlay, Predicate, SpatialResult};
use atlas_map::{Geometry, Position};
use geos::{Geom, Geometry as Native};

impl NativeGeos {
    pub(crate) fn batch_relations(
        &self,
        mask: &Geometry,
        values: &[Geometry],
        predicate: Predicate,
    ) -> SpatialResult<Vec<bool>> {
        let mask = self.read(mask)?;
        let prepared = mask.to_prepared_geom().map_err(|e| e.to_string())?;
        values
            .iter()
            .map(|value| {
                let input = self.read(value)?;
                match predicate {
                    Predicate::Covers => prepared.covers(&input),
                    Predicate::Intersects => prepared.intersects(&input),
                }
                .map_err(|e| e.to_string())
            })
            .collect()
    }
    pub(crate) fn batch_overlays(
        &self,
        mask: &Geometry,
        values: &[Geometry],
        operation: Overlay,
    ) -> SpatialResult<Vec<Option<Geometry>>> {
        let mask = self.read(mask)?;
        let prepared = mask.to_prepared_geom().map_err(|e| e.to_string())?;
        values
            .iter()
            .map(|value| {
                let input = self.read(value)?;
                let result = match operation {
                    Overlay::Intersection => {
                        if prepared.covers(&input).map_err(|e| e.to_string())? {
                            return Self::json(input);
                        }
                        input.intersection_prec(&mask, self.precision)
                    }
                    Overlay::Difference => input.difference_prec(&mask, self.precision),
                    Overlay::Union => input.union_prec(&mask, self.precision),
                }
                .map_err(|e| e.to_string())?;
                Self::json(result)
            })
            .collect()
    }
    pub(crate) fn batch_intersection_areas(
        &self,
        mask: &Geometry,
        values: &[Geometry],
    ) -> SpatialResult<Vec<f64>> {
        let mask = self.read(mask)?;
        let prepared = mask.to_prepared_geom().map_err(|e| e.to_string())?;
        values
            .iter()
            .map(|value| {
                let input = self.read(value)?;
                if !prepared.intersects(&input).map_err(|e| e.to_string())? {
                    return Ok(0.0);
                }
                if prepared.covers(&input).map_err(|e| e.to_string())? {
                    return input.area().map_err(|e| e.to_string());
                }
                input
                    .intersection_prec(&mask, self.precision)
                    .and_then(|value| value.area())
                    .map_err(|e| e.to_string())
            })
            .collect()
    }
    pub(crate) fn selected_area(
        &self,
        boundaries: &[Vec<Position>],
        includes: &mut dyn FnMut(Position) -> bool,
    ) -> SpatialResult<Option<Geometry>> {
        if boundaries.is_empty() {
            return Ok(None);
        }
        let lines = self.read(&Geometry::MultiLineString {
            coordinates: boundaries.to_vec(),
        })?;
        let noded = lines
            .unary_union_prec(self.precision)
            .map_err(|e| e.to_string())?;
        let faces = Native::polygonize(&[noded]).map_err(|e| e.to_string())?;
        let mut selected = Vec::new();
        for i in 0..faces.get_num_geometries().map_err(|e| e.to_string())? {
            let face = faces.get_geometry_n(i).map_err(|e| e.to_string())?;
            let point = Self::position(face.point_on_surface().map_err(|e| e.to_string())?)?;
            if includes(point) {
                selected.push(Geom::clone(&face).map_err(|e| e.to_string())?);
            }
        }
        if selected.is_empty() {
            return Ok(None);
        }
        let collection = Native::create_geometry_collection(selected).map_err(|e| e.to_string())?;
        Self::json(
            collection
                .unary_union_prec(self.precision)
                .map_err(|e| e.to_string())?,
        )
    }
}
