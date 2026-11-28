use super::{controls, province_settings::Settings, site_index::Sites, state::State};
use crate::{
    chance::{Chance, Warp},
    field::shared::{CellCode, SharedFields},
    lattice::TriangularLattice,
    rock::ground::{Ground, GroundField},
    spatial::{SpatialKernel, SpatialResult},
};
use atlas_map::Position;
use std::io;

pub(super) struct Indices<'a> {
    all: Sites<'a>,
    continent: Sites<'a>,
    ocean: Sites<'a>,
    homes: Vec<(usize, Sites<'a>)>,
    boundaries: Vec<Sites<'a>>,
}
pub(super) struct Selection {
    pub nearest: usize,
    pub second: Option<usize>,
    pub nearest_distance: f64,
    pub second_distance: f64,
    pub nearest_continental: Option<usize>,
    pub continental_distance: f64,
    pub oceanic_distance: f64,
    pub held: bool,
}
pub(super) struct Read<'a> {
    pub mesh: &'a TriangularLattice,
    pub state: &'a State,
    pub ground: &'a Ground,
    pub fields: &'a SharedFields,
    pub settings: &'a Settings,
    pub forming: bool,
}
impl<'a> Indices<'a> {
    pub fn new(
        kernel: &'a dyn SpatialKernel,
        mesh: &TriangularLattice,
        state: &State,
    ) -> SpatialResult<Self> {
        let all = Sites::new(kernel, mesh, state, |_| true)?;
        let continent = Sites::new(kernel, mesh, state, |i| {
            state.sites[i].province.assembly > 0
        })?;
        let ocean = Sites::new(kernel, mesh, state, |i| {
            state.sites[i].province.assembly == 0
        })?;
        let mut homes = Vec::new();
        let mut boundaries = Vec::new();
        for (n, site) in state.sites.iter().enumerate() {
            let assembly = site.province.assembly;
            if !homes.iter().any(|(id, _)| *id == assembly) {
                homes.push((
                    assembly,
                    Sites::new(kernel, mesh, state, |i| {
                        state.sites[i].province.assembly == assembly
                    })?,
                ));
            }
            boundaries.push(Sites::new(kernel, mesh, state, |i| {
                if i == n {
                    return false;
                }
                let loading = state.bond(n, i).is_some_and(|bond| {
                    bond.active && bond.extension - bond.shortening >= controls::RIFT_ACTIVATION
                });
                state.sites[i].plate != site.plate || loading
            })?);
        }
        Ok(Self {
            all,
            continent,
            ocean,
            homes,
            boundaries,
        })
    }
    pub fn select(
        &self,
        read: &Read<'_>,
        cells: std::ops::Range<usize>,
    ) -> io::Result<Vec<Selection>> {
        let points: Vec<_> = cells.clone().map(|cell| warped_point(read, cell)).collect();
        let nearest = self.all.nearest(&points).map_err(io::Error::other)?;
        let continent = self.continent.nearest(&points).map_err(io::Error::other)?;
        let ocean = self.ocean.nearest(&points).map_err(io::Error::other)?;
        let mut selections: Vec<_> = points
            .iter()
            .enumerate()
            .map(|(i, &point)| {
                Ok(Selection {
                    nearest: nearest[i].ok_or_else(|| {
                        io::Error::other("Crust assignment has no mechanical provinces")
                    })?,
                    second: None,
                    nearest_distance: distance(read, point, nearest[i]),
                    second_distance: f64::INFINITY,
                    nearest_continental: continent[i],
                    continental_distance: distance(read, point, continent[i]),
                    oceanic_distance: distance(read, point, ocean[i]),
                    held: false,
                })
            })
            .collect::<io::Result<_>>()?;
        if !read.forming {
            self.hold_continents(read, cells.start, &points, &mut selections)?;
        }
        for (nearest, index) in self.boundaries.iter().enumerate() {
            let members: Vec<_> = (0..selections.len())
                .filter(|&i| selections[i].nearest == nearest)
                .collect();
            if members.is_empty() {
                continue;
            }
            let positions: Vec<_> = members.iter().map(|&i| points[i]).collect();
            let seconds = index.nearest(&positions).map_err(io::Error::other)?;
            for (i, second) in members.into_iter().zip(seconds) {
                selections[i].second = second;
                selections[i].second_distance = distance(read, points[i], second);
            }
        }
        Ok(selections)
    }
    fn hold_continents(
        &self,
        read: &Read<'_>,
        start: usize,
        points: &[Position],
        selections: &mut [Selection],
    ) -> io::Result<()> {
        let fraction = read.ground.view(GroundField::CrustContinentalFraction);
        let assemblies = read.fields.code(CellCode::CrustAssemblyIds);
        for (assembly, index) in &self.homes {
            let mut members = Vec::new();
            for (offset, selection) in selections.iter().enumerate() {
                let cell = start + offset;
                if fraction.get(cell)? < 500.0
                    || read.state.sites[selection.nearest].province.assembly > 0
                    || assemblies.get(cell)? != *assembly as i32
                {
                    continue;
                }
                if !isolated_scrap(read, cell)? {
                    members.push(offset);
                }
            }
            if members.is_empty() {
                continue;
            }
            let positions: Vec<_> = members.iter().map(|&i| points[i]).collect();
            let homes = index.nearest(&positions).map_err(io::Error::other)?;
            for (i, home) in members.into_iter().zip(homes) {
                if let Some(home) = home {
                    selections[i].nearest = home;
                    selections[i].nearest_distance = distance(read, points[i], Some(home));
                    selections[i].held = true;
                }
            }
        }
        Ok(())
    }
}
fn isolated_scrap(read: &Read<'_>, cell: usize) -> io::Result<bool> {
    let fraction = read.ground.view(GroundField::CrustContinentalFraction);
    let mut land = 0;
    for edge in 0..3 {
        if let Some(next) = read.mesh.neighbor(cell, edge) {
            if fraction.get(next)? >= 500.0 {
                land += 1;
            }
        }
    }
    Ok(land * 2 < 3)
}
fn warped_point(read: &Read<'_>, cell: usize) -> Position {
    let [x, y] = read.mesh.position(cell);
    let seed = read.state.seed;
    let [east, north] = Warp::new(
        [Chance::of(seed, 0x16f1), Chance::of(seed, 0x62bd)],
        read.settings.continental_warp_scale,
        3,
    )
    .pull_on(read.mesh, [x, y]);
    let reach = read.settings.continental_warp_strength;
    Position::xy(read.mesh.delta_x(x + east * reach), y + north * reach)
}
fn distance(read: &Read<'_>, point: Position, site: Option<usize>) -> f64 {
    let Some(site) = site else {
        return f64::INFINITY;
    };
    let [x, y, _] = point.coordinates();
    let [sx, sy] = read.state.sites[site].province.position;
    read.mesh.delta_x(x - sx).hypot(y - sy)
}
