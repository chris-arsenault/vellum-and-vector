use super::{resources::Resource, Samples};
use crate::field::refinement::people::CensusCell;
use crate::{
    field::FieldSeed,
    human::{
        catalogue::LayerId,
        identity::{IdentityLayer, IDENTITY_SLOTS},
        HumanField,
    },
};
use std::io;

pub(super) fn install(samples: &Samples, seed: &mut FieldSeed, cell: usize) -> io::Result<()> {
    for (layer, name) in
        LayerId::ALL
            .into_iter()
            .zip(["Population", "Farmland", "Pasture", "BuiltUp", "Standing"])
    {
        if let Some(value) = samples.get(name, cell)? {
            seed.people
                .initialize(HumanField::Layer(layer), cell, value)?;
        }
    }
    for (field, name) in [
        (HumanField::RuinedBuiltUp, "RuinedBuiltUp"),
        (HumanField::RuinedStanding, "RuinedStanding"),
        (HumanField::RuinCover, "RuinCover"),
    ] {
        if let Some(value) = samples.get(name, cell)? {
            seed.people.initialize(field, cell, value)?;
        }
    }
    if let Some(value) = samples.get("RuinTongue", cell)? {
        seed.people
            .initialize_ruin_tongue(cell, (value + 0.5).floor() as i32)?;
    }
    let mut identities: [IdentityLayer; IDENTITY_SLOTS] =
        std::array::from_fn(|_| IdentityLayer::default());
    for (slot, identity) in identities.iter_mut().enumerate() {
        let get = |part| {
            samples
                .get(&format!("Identity{part}{slot}"), cell)
                .map(|v| v.unwrap_or(0.0))
        };
        identity.people = get("People")?;
        identity.hardness = get("Hardness")?;
        identity.age = get("Age")?;
        for (value, part) in identity
            .traditions
            .iter_mut()
            .zip(crate::human::identity::Tradition::NAMES)
        {
            // Maps captured before people knew a second tongue have no band for it.
            let read = if part == "Known" {
                get(part).unwrap_or(0.0)
            } else {
                get(part)?
            };
            *value = (read + 0.5).floor() as i32;
        }
    }
    seed.people.initialize_column(cell, &identities)
}

/// Retain the measured support of each household sample, including city cells
/// whose households come from a finer captured patch.
pub(crate) fn census_support(
    mesh: &crate::lattice::TriangularLattice,
    spatial: &dyn crate::spatial::SpatialKernel,
    source: &Resource,
) -> io::Result<Vec<CensusCell>> {
    let [ox, oy] = mesh.origin();
    let points: Vec<_> = (0..mesh.len())
        .map(|i| {
            let [x, y] = mesh.position(i);
            [x + ox, y + oy]
        })
        .collect();
    let mut cells = vec![
        CensusCell {
            id: 0,
            centre: [0.; 2],
            span: 0.,
            density: 0.
        };
        points.len()
    ];
    fn sample(
        spatial: &dyn crate::spatial::SpatialKernel,
        src: &Resource,
        points: &[[f64; 2]],
        indices: &[usize],
        cells: &mut [CensusCell],
        offset: &mut usize,
    ) -> io::Result<()> {
        let base = *offset;
        *offset += src.grid.measures.len();
        let positions: Vec<_> = indices.iter().map(|&i| points[i]).collect();
        let locations = src.grid.locate_points(&positions)?;
        let population = src
            .channels
            .get("Population")
            .ok_or_else(|| io::Error::other("Captured census has no Population channel"))?
            .values
            .read_values()?;
        for (&i, at) in indices.iter().zip(locations) {
            let p = src.grid.chart(points[i]);
            let donor = src.grid.sample_index(src.grid.located_point(at)?)?;
            let mut centre = src.grid.position(donor)?;
            centre[0] += points[i][0] - p[0];
            cells[i] = CensusCell {
                id: base + donor,
                centre,
                span: src.grid.measures.get(donor)?.sqrt(),
                density: population.get(donor)?,
            };
        }
        for overlay in src
            .overlays
            .iter()
            .filter(|o| o.channels.iter().any(|c| c == "Population"))
        {
            let grid = &overlay.resource.grid;
            let [w, s, e, n] = grid.bounds;
            let footprint = crate::features::chart::working(
                &overlay.footprint,
                atlas_map::Bounds(w, s, e, n),
                grid.periodic_width,
                spatial,
            )
            .map_err(io::Error::other)?;
            let positions: Vec<_> = indices
                .iter()
                .map(|&i| {
                    let [x, y] = grid.chart(points[i]);
                    atlas_map::Position::xy(x, y)
                })
                .collect();
            let inside = spatial
                .covers_points(&footprint, &positions)
                .map_err(io::Error::other)?;
            let selected: Vec<_> = indices
                .iter()
                .zip(inside)
                .filter_map(|(&i, b)| b.then_some(i))
                .collect();
            sample(spatial, &overlay.resource, points, &selected, cells, offset)?;
        }
        Ok(())
    }
    sample(
        spatial,
        source,
        &points,
        &(0..points.len()).collect::<Vec<_>>(),
        &mut cells,
        &mut 0,
    )?;
    Ok(cells)
}
