use super::{
    channel_geometry::ChannelInputs,
    drainage::Conditioning,
    groundwater::GroundwaterInputs,
    guidance::GuidanceInputs,
    lakes::LakeInputs,
    meltwater::MeltInputs,
    ocean::{FormationBudget, OceanInputs, SurfaceRefresh},
    owner::Water,
    routing::RoutingInputs,
    runoff::LandWaterInputs,
    warmth::WarmthInputs,
};
use crate::storage::Coverage;
use std::io;

impl Water {
    pub fn with_passage<T>(
        &mut self,
        input: super::passage::PassageInputs<'_>,
        read: impl FnOnce(&super::passage::ChannelPassage<'_>) -> io::Result<T>,
    ) -> io::Result<T> {
        let passage = self.rivers.prepare_passage(input)?;
        read(&passage)
    }
    pub fn prepare_lakes(&mut self) -> io::Result<()> {
        self.column.borrow_mut().clear_lakes()
    }
    pub fn lake_basins_with_passage(
        &mut self,
        input: LakeInputs<'_>,
        passage: super::passage::PassageInputs<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let boundary = super::year_routing::BoundaryRivers::new(&self.rivers, coverage)?;
        let incoming = boundary.as_ref().map(|value| value.incoming.read_only());
        let passage = self.rivers.prepare_passage(passage)?;
        self.column.borrow_mut().lake_basins(
            LakeInputs {
                incoming: incoming.as_ref(),
                passage: &|cell, received| Ok(passage.parts(cell, received)?.passed),
                ..input
            },
            coverage,
        )
    }
    pub fn condition(
        &mut self,
        input: Conditioning<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let boundary = super::year_routing::BoundaryRivers::new(&self.rivers, coverage)?;
        let incoming = boundary.as_ref().map(|value| value.incoming.read_only());
        self.drainage.condition(
            Conditioning {
                mesh: &self.mesh,
                water_kind: &self.column.borrow().kinds(),
                incoming: incoming.as_ref(),
                ..input
            },
            coverage,
        )
    }
    pub fn guide(&mut self, input: GuidanceInputs<'_>, coverage: &mut Coverage) -> io::Result<()> {
        self.drainage.guide(
            GuidanceInputs {
                mesh: &self.mesh,
                scale: &self.scale,
                water_kind: &self.column.borrow().kinds(),
                ..input
            },
            &self.rivers,
            coverage,
        )
    }
    pub fn lake_basins(
        &mut self,
        input: LakeInputs<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let boundary = super::year_routing::BoundaryRivers::new(&self.rivers, coverage)?;
        let incoming = boundary.as_ref().map(|value| value.incoming.read_only());
        let drainage = self.drainage.read_only();
        self.column.borrow_mut().lake_basins(
            LakeInputs {
                scale: &self.scale,
                drainage: &drainage,
                stage: super::lake_stage::StageInputs {
                    mesh: &self.mesh,
                    parents: &drainage.parents,
                    ..input.stage
                },
                incoming: incoming.as_ref(),
                ..input
            },
            coverage,
        )
    }
    pub fn route(
        &mut self,
        seed: i32,
        open_boundary: bool,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let column = self.column.borrow().read_only();
        let drainage = self.drainage.read_only();
        // This is the field's open-outlet rule, including support edges on a regional mesh.
        let mut outlets = vec![false; self.mesh.len()];
        for (cell, outlet) in outlets.iter_mut().enumerate() {
            *outlet = self.mesh.boundary(cell)
                && (open_boundary
                    || (self.mesh.open_boundary()
                        && drainage.parents.get(cell)? < 0
                        && drainage.ranks.get(cell)? >= 0));
        }
        self.routing.route(
            RoutingInputs {
                mesh: &self.mesh,
                water_kind: &column.kind,
                water_body: &column.body,
                lake_outlets: &column.lake_outlet,
                drainage: &drainage,
                open_outlet: &|cell| outlets[cell],
                seed,
            },
            &self.rivers,
            coverage,
        )
    }
    pub fn advance_year(&mut self, input: LandWaterInputs<'_>) -> io::Result<()> {
        self.column.borrow_mut().advance_year(
            LandWaterInputs {
                mesh: &self.mesh,
                ..input
            },
            &mut self.ledger,
        )
    }
    pub fn project_runoff(&mut self) -> io::Result<()> {
        self.runoff.project(&self.column.borrow())
    }
    pub fn advance_groundwater(
        &mut self,
        input: GroundwaterInputs<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let column = self.column.borrow().read_only();
        self.groundwater.advance(
            GroundwaterInputs {
                mesh: &self.mesh,
                scale: &self.scale,
                water_kind: &column.kind,
                recharge: &column.year[12],
                seepage: &self.flow.read_only().seepage,
                sea_level: self.ocean.effective_level,
                ..input
            },
            &mut self.column.borrow_mut(),
            &mut self.ledger,
            coverage,
        )
    }
    pub fn release_meltwater(
        &mut self,
        input: MeltInputs<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let column = self.column.borrow().read_only();
        self.melt.release_year(
            MeltInputs {
                mesh: &self.mesh,
                water_kind: &column.kind,
                snow_kept: &column.year[13],
                ..input
            },
            &mut self.ledger,
            coverage,
        )
    }
    pub fn initialize_ocean(
        &mut self,
        input: OceanInputs<'_>,
        formation: FormationBudget,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        self.ocean.initialize_budget(
            &OceanInputs {
                mesh: &self.mesh,
                scale: &self.scale,
                ..input
            },
            formation,
            coverage,
        )
    }
    pub fn ocean_surface(
        &mut self,
        input: OceanInputs<'_>,
        offset: f64,
        stand: &dyn Fn(usize, f64) -> io::Result<f64>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        self.ocean.surface(
            &OceanInputs {
                mesh: &self.mesh,
                scale: &self.scale,
                ..input
            },
            offset,
            &mut self.column.borrow_mut(),
            stand,
            coverage,
        )
    }
    pub fn prepare_ocean_surface(
        &mut self,
        input: &OceanInputs<'_>,
        offset: f64,
        coverage: &mut Coverage,
    ) -> io::Result<SurfaceRefresh> {
        self.ocean
            .prepare_surface(input, offset, &mut self.column.borrow_mut(), coverage)
    }
    pub fn finish_ocean_surface(
        &mut self,
        input: &OceanInputs<'_>,
        stand: &crate::storage::ReadBand<f64>,
        previous: SurfaceRefresh,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        self.ocean.finish_surface(
            input,
            &mut self.column.borrow_mut(),
            &|cell, _| stand.get(cell),
            previous,
            coverage,
        )
    }
    pub fn channel_geometry(
        &mut self,
        input: ChannelInputs<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let routing = self.routing.read_only();
        self.channels.project(
            ChannelInputs {
                mesh: &self.mesh,
                scale: &self.scale,
                targets: &routing.targets,
                orders: &self.projection.orders(),
                kind: &self.column.borrow().kinds(),
                basins: &routing.basins,
                flow: &self.flow.read_only().mean,
                ..input
            },
            &mut self.rivers,
            &mut self.projection,
            coverage,
        )
    }
    pub fn clear_channel_geometry(&mut self) -> io::Result<()> {
        self.channels.clear()
    }
    pub fn clear_glacial_meltwater(&mut self) -> io::Result<()> {
        self.melt.clear_glacial()
    }
    pub fn river_warmth(
        &mut self,
        forcing: &crate::storage::ReadBand<f64>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        self.warmth.project(
            WarmthInputs {
                mesh: &self.mesh,
                scale: &self.scale,
                targets: &self.routing.read_only().targets,
                orders: &self.projection.orders(),
                kind: &self.column.borrow().kinds(),
                forcing,
            },
            coverage,
        )
    }
}
