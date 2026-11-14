use super::{
    queries::{detachment_spread, seam_continuity, yielding_plane, Extent, YieldingPlane},
    Ground,
};
use crate::{scale::MapScale, settlement::removal::Facet};
use std::io;
struct Part {
    share: f64,
    surface: f64,
    plane: YieldingPlane,
}
impl Ground {
    fn facet_planes(&self, cell: usize) -> io::Result<Vec<Part>> {
        let query = yielding_plane(|_| 1.0, Extent::Detachment);
        let mut result = Vec::with_capacity(2);
        for facet in Facet::ALL {
            let share = self.share(cell, facet)?;
            if share > 0.0 {
                result.push(Part {
                    share,
                    surface: self.surface(cell, facet)?,
                    plane: self.fold(cell, &query, Some(facet))?,
                });
            }
        }
        Ok(result)
    }
    pub fn inherited_detachment(&self, cell: usize) -> io::Result<f64> {
        let source: Vec<_> = self
            .facet_planes(cell)?
            .into_iter()
            .filter(|p| p.plane.overburden > 0.0)
            .collect();
        if source.is_empty() {
            return Ok(0.0);
        }
        let mut connected = [0.0; 2];
        let mut faces = 0.0;
        for edge in 0..3 {
            let Some(next) = self.mesh.neighbor(cell, edge) else {
                continue;
            };
            let face = self.mesh.face_length(cell, edge);
            let distance = self.mesh.edge_length(cell, edge);
            let direction = self.mesh.edge_direction(cell, edge);
            let dx = MapScale::native(direction[0] * distance);
            let dy = MapScale::native(direction[1] * distance);
            let neighbors = self.facet_planes(next)?;
            for (index, a) in source.iter().enumerate() {
                for b in &neighbors {
                    connected[index] += face
                        * b.share
                        * seam_continuity(&a.plane, &b.plane, b.surface - a.surface, dx, dy);
                }
            }
            faces += face;
        }
        Ok(source
            .iter()
            .enumerate()
            .map(|(index, part)| {
                part.share
                    * detachment_spread(
                        &part.plane,
                        if faces > 0.0 {
                            connected[index] / faces
                        } else {
                            0.0
                        },
                    )
            })
            .sum())
    }
}
