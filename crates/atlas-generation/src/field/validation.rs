//! Existing field representation and reference checks at physical publication boundaries.
use super::{
    glaciers::{surface::Surface, Settings},
    shared::{CellCode as C, Flag, Scalar as S},
    Field,
};
use crate::{
    execution::{Query, QueryDependency},
    flow_graph,
    rock::ground::GroundField as G,
    water::column::{Store, NO_WATER_SURFACE},
};
use std::{io, rc::Rc};

fn require(condition: bool, message: &str) -> io::Result<()> {
    if condition {
        Ok(())
    } else {
        Err(io::Error::other(message))
    }
}
impl Field {
    pub fn check_landscape(&self) -> io::Result<()> {
        let ground = self.ground();
        for cell in 0..self.mesh.len() {
            for field in [G::Elevation, G::BedrockElevation, G::SedimentThickness] {
                require(
                    ground.view(field).get(cell)?.is_finite(),
                    "Landscape has a nonfinite surface",
                )?;
            }
            for field in [G::SedimentThickness, G::CumulativeDeposition] {
                require(
                    ground.view(field).get(cell)? >= 0.0,
                    "Landscape has negative retained material",
                )?;
            }
            for field in [
                S::CumulativeFluvialErosion,
                S::CumulativeGlacialErosion,
                S::CumulativeGlacialDeposition,
                S::CumulativeCoastalErosion,
            ] {
                require(
                    self.shared.scalar(field).get(cell)? >= 0.0,
                    "Landscape has negative material history",
                )?;
            }
        }
        Ok(())
    }
    pub fn check_drainage(&self, open_boundary: bool) -> io::Result<()> {
        let water = self.water();
        for cell in 0..self.mesh.len() {
            let target = water.routing.targets.get(cell)?;
            let kind = water.column.kind.get(cell)?;
            if target < 0 {
                let open = self.mesh.boundary(cell)
                    && (open_boundary
                        || (self.mesh.open_boundary()
                            && water.drainage.parents.get(cell)? < 0
                            && water.drainage.ranks.get(cell)? >= 0));
                require(kind != 0 || open, "Dry triangle has no drainage outlet")?;
                continue;
            }
            let target = target as usize;
            require(
                (0..3).any(|edge| self.mesh.neighbor(cell, edge) == Some(target)),
                "Flow target is not an adjacent triangle",
            )?;
            require(
                kind != 0
                    || water.column.kind.get(target)? == 1
                    || water.drainage.elevations.get(target)?
                        <= water.drainage.elevations.get(cell)?,
                "Conditioned drainage flows uphill",
            )?;
        }
        flow_graph::target_order(&mut self.coverage.borrow_mut(), &water.routing.targets)?;
        Ok(())
    }
    pub fn check_channels(&self) -> io::Result<()> {
        let water = self.water();
        for cell in 0..self.mesh.len() {
            let strength = water.channels.strength.get(cell)?;
            let order = water.channels.orders.get(cell)?;
            let river = water.river_orders.get(cell)?;
            require(
                (0.0..=1000.0).contains(&strength)
                    && (strength == 0.0) == (order == 0)
                    && (strength <= 0.0 || water.column.kind.get(cell)? == 0),
                "River channel coverage is inconsistent with its flow spine",
            )?;
            require(
                river == 0 || (strength > 0.0 && order >= river),
                "River channel does not cover its flow spine",
            )?;
        }
        Ok(())
    }
    pub fn check_ice_flow(&self, settings: &Settings) -> io::Result<()> {
        let water = self.water();
        let surface = Surface::new(&self.ground(), &self.shared, &water);
        for cell in 0..self.mesh.len() {
            let grounded = self.shared.flag(Flag::GroundedIce).get(cell)?;
            require(
                grounded <= 1 && (grounded == 0 || surface.grounded(cell, settings)?),
                "Ice grounding contradicts its support surface",
            )?;
            require(
                self.shared.scalar(S::IceFlux).get(cell)? + 1e-6
                    >= self.shared.scalar(S::IceThickness).get(cell)? * self.mesh.area(cell)
                        / settings.ice_transport_years,
                "Ice flow contradicts its support surface",
            )?;
        }
        Ok(())
    }
    pub fn structural_validation(
        settings: Rc<Settings>,
        open_boundary: bool,
        landforms_available: impl Fn() -> bool + 'static,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        Query::new(
            "physical-structural-validation",
            dependencies,
            move |field: &Field, _| {
                field.check_codes(landforms_available())?;
                field.check_water(open_boundary)?;
                flow_graph::target_order(
                    &mut field.coverage.borrow_mut(),
                    &field.water().routing.targets,
                )?;
                field.check_river_references()?;
                field.check_ice_history(&settings)?;
                field.check_landscape()?;
                Ok(())
            },
        )
    }
    fn check_codes(&self, landforms_available: bool) -> io::Result<()> {
        let water = self.water();
        for cell in 0..self.mesh.len() {
            require(
                (i32::from(landforms_available)..=17)
                    .contains(&self.shared.code(C::LandformCodes).get(cell)?)
                    && water.column.kind.get(cell)? <= 2
                    && (0..=4).contains(&self.shared.code(C::BathymetricZoneCodes).get(cell)?)
                    && self.shared.code(C::FeatureFlags).get(cell)? & !4095 == 0,
                "Physical geography contains an invalid primitive code",
            )?;
            require(
                (0.0..=1000.0).contains(&water.channels.strength.get(cell)?)
                    && (0.0..=1000.0)
                        .contains(&self.shared.scalar(S::FloodplainIntensity).get(cell)?)
                    && (0.0..=1000.0).contains(&self.shared.scalar(S::DeltaIntensity).get(cell)?),
                "Physical geography contains an invalid river-geometry value",
            )?;
        }
        Ok(())
    }
    fn check_water(&self, open_boundary: bool) -> io::Result<()> {
        let water = self.water();
        let elevation = self.ground().view(G::Elevation);
        let mut bodies = 0;
        for cell in 0..self.mesh.len() {
            bodies = bodies.max(water.column.body.get(cell)? + 1);
        }
        let mut surfaces = vec![f64::NAN; bodies as usize];
        let mut ocean = false;
        for cell in 0..self.mesh.len() {
            let kind = water.column.kind.get(cell)?;
            let dry = kind == 0;
            let surface = water.column.surface.get(cell)?;
            let depth = water.column.store(Store::Standing).contents().get(cell)?;
            require(
                dry == (surface == NO_WATER_SURFACE) && dry == (depth == 0.0),
                "Physical water surface and depth disagree",
            )?;
            require(
                dry || surface - elevation.get(cell)? == depth,
                "Physical water depth does not match surface minus floor",
            )?;
            let body = water.column.body.get(cell)?;
            if kind == 1 {
                ocean = true;
                require(
                    body == 1 && depth > 0.0,
                    "Ocean triangle lacks depth or body identity",
                )?;
            } else if kind == 2 {
                require(
                    body > 1 && depth > 0.0,
                    "Lake triangle lacks a water body identity",
                )?;
                let previous = &mut surfaces[body as usize];
                require(
                    previous.is_nan() || *previous == surface,
                    "Lake triangle lacks a consistent water surface",
                )?;
                *previous = surface;
            }
        }
        require(
            ocean || open_boundary || self.mesh.open_boundary(),
            "Physical geography contains no connected ocean",
        )
    }
    fn check_river_references(&self) -> io::Result<()> {
        let owner = self.water.borrow();
        let rivers = owner.rivers();
        for reach in rivers.reaches() {
            require(
                reach
                    .downstream()
                    .is_none_or(|id| id != reach.id() && rivers.get(id).is_some()),
                "Retained river has an invalid receiving reach",
            )?;
            for &cell in reach.cells() {
                require(
                    cell < self.mesh.len(),
                    "Retained river has a cell outside this map",
                )?;
            }
        }
        Ok(())
    }
    fn check_ice_history(&self, settings: &Settings) -> io::Result<()> {
        let water = self.water();
        let surface = Surface::new(&self.ground(), &self.shared, &water);
        for cell in 0..self.mesh.len() {
            let grounded = self.shared.flag(Flag::GroundedIce).get(cell)?;
            require(
                grounded <= 1
                    && (grounded == 0 || surface.grounded(cell, settings)?)
                    && self.shared.scalar(S::MaximumGroundedIceFlux).get(cell)?
                        <= self.shared.scalar(S::MaximumIceFlux).get(cell)?,
                "Grounded-ice history contradicts physical support",
            )?;
        }
        Ok(())
    }
}
