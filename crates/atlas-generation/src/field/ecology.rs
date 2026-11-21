//! Ecological lifecycle operations retain the shared field's ground and water ownership.
use super::{shared::CellCode, Field};
use crate::{
    atlas::{context::EcologyEpoch, parameters::AtlasParameters},
    ecology::{
        self,
        forcing::Inputs,
        ignition,
        lifecycle::{self, Authority, Development},
        Habitat,
    },
    execution::{Command, CommandKind, Query, QueryDependency},
    magic::state::MagicField,
    spatial::SpatialKernel,
};
use std::io;
pub mod world;

pub struct RegionalDevelopment<'a> {
    pub development: Development,
    pub forcing: &'a Inputs,
    pub authority: &'a Authority,
    pub seats: &'a [usize],
    pub seat_radius: f64,
    pub spatial: &'a dyn SpatialKernel,
}
pub fn prepare_child() -> Command<Field, i32> {
    Command::with_inputs(
        "regional.ecology-initialize",
        CommandKind::Initialize,
        vec![],
        |scope, seed: &i32| {
            scope.state_mut().with_ecology(|map, initialized, _| {
                lifecycle::prepare_child(map, initialized, *seed)
            })?;
            Ok(())
        },
    )
}
pub fn develop_child<'a>(
    dependencies: Vec<QueryDependency<Field>>,
) -> Command<Field, RegionalDevelopment<'a>> {
    Command::with_inputs(
        "regional.ecology-develop",
        CommandKind::Work,
        dependencies,
        |scope, input: &RegionalDevelopment<'_>| {
            if input.development.exposure <= 0.0 {
                return Ok(());
            }
            scope
                .state_mut()
                .with_ecology(|map, initialized, coverage| {
                    let fire = ignition::causes(
                        map,
                        &ignition::Causes {
                            seed: input.development.seed,
                            round: input.development.round,
                            seats: input.seats,
                            seat_radius: input.seat_radius,
                        },
                        input.spatial,
                        coverage,
                    )?;
                    lifecycle::develop(
                        map,
                        initialized,
                        &input.development,
                        &|cell| {
                            let mut forcing = input.forcing.at(cell)?;
                            forcing.fire += f64::from(fire.get(cell)?);
                            Ok(forcing)
                        },
                        &|map, cell| input.authority.restore(map, cell),
                        coverage,
                    )
                })?;
            Ok(())
        },
    )
}
pub fn classify_child(dependencies: Vec<QueryDependency<Field>>) -> Query<Field, ()> {
    classify("regional.ecology-present", dependencies)
}
pub fn classify_world(dependencies: Vec<QueryDependency<Field>>) -> Query<Field, ()> {
    classify("atlas.ecology-present", dependencies)
}
fn classify(name: &str, dependencies: Vec<QueryDependency<Field>>) -> Query<Field, ()> {
    Query::new(name, dependencies, move |field: &Field, _| {
        let mut codes = field.shared.derive_code(CellCode::BiomeCodes);
        for cell in 0..field.mesh.len() {
            let environment =
                ecology::environment::environment(field, cell, &ecology::Forcing::default())?;
            codes.set(
                cell,
                ecology::biomes::classify(field, cell, &environment)? as i32,
            )?;
        }
        Ok(())
    })
}
impl Field {
    fn with_ecology<T>(
        &mut self,
        run: impl FnOnce(&mut Habitat<'_>, &mut bool, &mut crate::storage::Coverage) -> io::Result<T>,
    ) -> io::Result<T> {
        let water = self.water.borrow();
        let view = water.read_only();
        let rivers = water.river_reader();
        let mut ground = self.ground.borrow_mut();
        let mut map = Habitat {
            mesh: &self.mesh,
            scale: &self.scale,
            fields: &mut self.shared,
            ground: &mut ground,
            water: &view,
            rivers: &rivers,
        };
        run(
            &mut map,
            &mut self.ecology_initialized,
            &mut self.coverage.borrow_mut(),
        )
    }
    pub fn ecological_forcing(
        &self,
        magic: &[MagicField],
        parameters: &AtlasParameters,
        epoch: &EcologyEpoch,
        // How people use the land, from the shared questions; refined maps develop without.
        land_use: Option<crate::ecology::forcing::LandUse>,
    ) -> io::Result<Inputs> {
        let inputs = Inputs::new(&self.shared, magic, &self.scale, parameters, epoch)?;
        Ok(match land_use {
            Some(used) => inputs.with_land_use(used),
            None => inputs,
        })
    }
    pub fn ecology_authority(
        &self,
        woodland: &[atlas_map::Geometry],
        spatial: &dyn SpatialKernel,
        chart: Option<&crate::features::chart::Chart<'_>>,
    ) -> io::Result<Authority> {
        let mut mask = self.coverage.borrow_mut().allocate(0);
        let [ox, oy] = self.mesh.origin();
        for shape in woodland {
            for start in (0..self.mesh.len()).step_by(4096) {
                let end = (start + 4096).min(self.mesh.len());
                let points = (start..end)
                    .map(|cell| {
                        let [x, y] = self.mesh.position(cell);
                        let position = atlas_map::Position::xy(ox + x, oy + y);
                        chart.map_or(position, |chart| chart.position(position))
                    })
                    .collect::<Vec<_>>();
                let covered = spatial
                    .covers_points(shape, &points)
                    .map_err(io::Error::other)?;
                for (offset, covered) in covered.into_iter().enumerate() {
                    if covered {
                        mask.set(start + offset, 1)?;
                    }
                }
            }
        }
        Ok(Authority {
            woodland: mask.read_only(),
            fixed: Vec::new(),
            regional: chart.is_some(),
        })
    }
}
