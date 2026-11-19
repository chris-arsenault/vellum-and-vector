use super::{
    network::RiverTerrain,
    owner::Water,
    passage::PassageInputs,
    routed_network::NetworkInputs,
    visibility::VisibilityInputs,
    year_routing::{BoundaryRivers, RoutedYear, RoutingInputs},
};
use crate::{
    rock::columns::Column,
    storage::{Coverage, ReadBand},
};
use std::io;

pub struct NetworkEnvironment<'a> {
    pub surface_water: &'a ReadBand<f64>,
    pub bed: &'a dyn Fn(usize) -> io::Result<f64>,
    pub cut_share: &'a ReadBand<f64>,
    pub permeability: &'a dyn Fn(usize, Option<Column>) -> io::Result<f64>,
    pub groundwater_filled: &'a dyn Fn(usize) -> io::Result<f64>,
    pub open_bed_seepage: f64,
    pub withdrawal: ReadBand<f64>,
    pub transmission: ReadBand<f64>,
    pub lake_evaporation: f64,
    pub lake_seepage: f64,
    pub lake_infiltration_loss: f64,
    pub epoch: f64,
}
impl Water {
    pub fn inherit_network(
        &mut self,
        input: &super::captured::DrainageNetwork,
        context: super::inherit::RiverInheritance<'_>,
        feature: impl Fn(atlas_map::Id) -> Option<super::captured::RiverIdentity>,
    ) -> crate::spatial::SpatialResult<()> {
        if self.rivers.reaches().next().is_some() || !self.rivers.entries.is_empty() || !input.input
        {
            return Ok(());
        }
        self.rivers.inherit(input, context, feature)?;
        self.projection
            .project_orders(&self.rivers, &self.column.borrow().read_only().kind)
            .map_err(|error| error.to_string())
    }
    pub fn associate_publication(&mut self, river: &str, record: Option<&str>, name: &str) {
        self.rivers.associate_publication(river, record, name);
    }
    pub fn retain_course(
        &mut self,
        cells: &[usize],
        identity: &str,
        name: Option<&str>,
        bed: impl Fn(usize) -> io::Result<f64>,
    ) -> io::Result<Option<usize>> {
        self.rivers.retain_course(cells, identity, name, bed)
    }
    fn routed_year(
        &mut self,
        environment: &NetworkEnvironment<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<RoutedYear> {
        let column = self.column.borrow().read_only();
        let routing = self.routing.read_only();
        let boundary = BoundaryRivers::new(&self.rivers, coverage)?;
        let passage = self.rivers.prepare_passage(PassageInputs {
            mesh: &self.mesh,
            water_kind: &column.kind,
            cut_share: environment.cut_share,
            permeability: environment.permeability,
            filled: environment.groundwater_filled,
            open_bed_seepage: environment.open_bed_seepage,
            withdrawal: environment.withdrawal.clone(),
            transmission: environment.transmission.clone(),
        })?;
        self.flow.route_with_boundary(
            &RoutingInputs {
                mesh: &self.mesh,
                targets: &routing.targets,
                water_kind: &column.kind,
                surface_water: environment.surface_water,
                runoff: &self.runoff.read_only().mean,
                meltwater: &self.melt.read_only().glacial,
                year: &std::array::from_fn(|month| column.year[month].clone()),
                lake_outlets: &column.lake_outlet,
                lake_overflow: &column.lake_overflow,
                lake_evaporation: environment.lake_evaporation,
                lake_seepage: environment.lake_seepage,
                lake_infiltration_loss: environment.lake_infiltration_loss,
                passage: &|cell, received| passage.parts(cell, received),
            },
            boundary.as_ref(),
            &mut self.ledger,
            coverage,
        )
    }
    /// Query refreshes flow profiles; it never establishes a new course or consumes latent input.
    pub fn refresh_network(
        &mut self,
        environment: NetworkEnvironment<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let year = self.routed_year(&environment, coverage)?;
        self.rivers.refresh_routed(
            NetworkInputs {
                mesh: &self.mesh,
                scale: &self.scale,
                water_kind: &self.column.borrow().read_only().kind,
                targets: &self.routing.read_only().targets,
                catchment: &self.flow.read_only().catchment,
                bed: environment.bed,
                epoch: environment.epoch,
            },
            &year,
        )?;
        self.project_network()
    }
    /// Explicit evolution alone changes courses, dry history and established identities.
    pub fn advance_network(
        &mut self,
        environment: NetworkEnvironment<'_>,
        channel_length: Option<&ReadBand<f64>>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let year = self.routed_year(&environment, coverage)?;
        let column = self.column.borrow().read_only();
        let routing = self.routing.read_only();
        let flow = self.flow.read_only();
        self.rivers.advance_routed(
            NetworkInputs {
                mesh: &self.mesh,
                scale: &self.scale,
                water_kind: &column.kind,
                targets: &routing.targets,
                catchment: &flow.catchment,
                bed: environment.bed,
                epoch: environment.epoch,
            },
            &year,
            channel_length,
            coverage,
        )?;
        self.rivers.establish_identities(VisibilityInputs {
            mesh: &self.mesh,
            scale: &self.scale,
            targets: &routing.targets,
            water_kind: &column.kind,
            body: &column.body,
            flood: &flow.flood,
            catchment: &flow.catchment,
        })?;
        self.project_network()
    }
    fn project_network(&mut self) -> io::Result<()> {
        self.rivers.mark_drawn();
        let terrain = RiverTerrain {
            mesh: &self.mesh,
            water_kind: &self.column.borrow().read_only().kind,
            targets: &self.routing.read_only().targets,
        };
        self.projection
            .project(&self.rivers, &terrain, &self.flow.read_only().flood)?;
        self.projection.project_spines(&terrain)
    }
}
