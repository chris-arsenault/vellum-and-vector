use super::shared::{Scalar, SharedFields};
use crate::{
    human::{HumanLayers, HumanSeed},
    lattice::TriangularLattice,
    rock::{
        cargo_identity::CargoIdentities,
        columns::RockColumns,
        ground::{Ground, GroundEvents, GroundField, GroundInputs, GroundSeed, GroundStorage},
        load::MaterialLoad,
    },
    scale::{MapScale, RelativeMeasure},
    storage::{Band, Coverage, SharedCache},
    water::{column::WaterMedium, Water, WaterView},
};
use std::{
    cell::{OnceCell, Ref, RefCell},
    io,
    rc::{Rc, Weak},
};

/// Construction owns writers until they move into their individual domain owners.
pub struct FieldSeed {
    pub shared: SharedFields,
    pub ground: GroundSeed,
    pub people: HumanSeed,
    pub ground_load: MaterialLoad,
    pub sea_load: MaterialLoad,
    pub tectonics: Option<crate::tectonics::state::State>,
    pub crust_formed: bool,
    pub support_datum: Option<Band<f64>>,
    pub faults: Vec<super::fractures::Fault>,
    pub events: Vec<super::events::Event>,
    pub sea_ice_evolved_epoch: i32,
    pub last_plate_drift_step: f64,
    pub province_seams_marked: bool,
    pub ecology_initialized: bool,
    pub accumulated_plate_drift: f64,
    pub landmark_ledger: Vec<super::landmark_ledger::LandmarkRecord>,
    pub magic_sources: Vec<super::landmarks::magic::Source>,
    mesh: Rc<TriangularLattice>,
    coverage: Coverage,
}
impl FieldSeed {
    pub fn new(mesh: Rc<TriangularLattice>, scale: MapScale, cache: SharedCache) -> Self {
        let mut coverage = Coverage::new(mesh.clone(), cache);
        Self {
            shared: SharedFields::new(&mut coverage),
            ground: GroundSeed {
                storage: GroundStorage::new(&mut coverage),
                columns: RockColumns::new(&mut coverage),
                identities: CargoIdentities::default(),
                scale,
                sea_level: 0.0,
                completed_epochs: 0.0,
                crust_initialized: false,
                support_initialized: false,
            },
            people: HumanSeed::new(&mut coverage),
            ground_load: MaterialLoad::ground(&mut coverage, mesh.clone()),
            sea_load: MaterialLoad::new(&mut coverage),
            tectonics: None,
            crust_formed: false,
            support_datum: None,
            faults: Vec::new(),
            events: Vec::new(),
            sea_ice_evolved_epoch: -1,
            last_plate_drift_step: 0.0,
            province_seams_marked: false,
            ecology_initialized: false,
            accumulated_plate_drift: 0.0,
            landmark_ledger: Vec::new(),
            magic_sources: Vec::new(),
            mesh,
            coverage,
        }
    }
    pub fn finish(mut self, events: Box<dyn GroundEvents>) -> io::Result<Field> {
        let scale = self.ground.scale;
        let ground_link: Rc<OnceCell<Weak<RefCell<Ground>>>> = Rc::new(OnceCell::new());
        let soil_depth = self.ground.storage.view(GroundField::SoilDepth);
        let carbon = self.shared.scalar(Scalar::SoilCarbon);
        let capacity_link = ground_link.clone();
        let capacity_depth = self
            .ground
            .scale
            .resolve(RelativeMeasure::length(2.5e-6).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value();
        let water = Rc::new(RefCell::new(Water::new(
            self.mesh.clone(),
            scale,
            &mut self.coverage,
            WaterMedium {
                elevation: self.ground.storage.view(GroundField::Elevation),
                soil_capacity: Rc::new(move |cell| {
                    Ok(crate::water::soil::capacity(
                        soil_depth.get(cell)?,
                        carbon.get(cell)?,
                    ))
                }),
                groundwater_capacity: Rc::new(move |cell| {
                    let owner = capacity_link.get().and_then(Weak::upgrade).ok_or_else(|| {
                        io::Error::other("Water substrate owner is no longer available")
                    })?;
                    let ground = owner.try_borrow().map_err(io::Error::other)?;
                    Ok(
                        capacity_depth
                            * crate::water::substrate::permeability(&ground, cell, None)?,
                    )
                }),
            },
        )));
        let inputs = GroundInputs {
            tree: self.shared.scalar(Scalar::TreeCover),
            grass: self.shared.scalar(Scalar::GrassCover),
            wetland: self.shared.scalar(Scalar::WetlandCover),
            ice: self.shared.scalar(Scalar::IceThickness),
            fire: self.shared.scalar(Scalar::FireActivity),
            fracture: self.shared.scalar(Scalar::FractureConductance),
            ward: self.shared.scalar(Scalar::Warding),
            marine: water.borrow().kinds(),
            root_hold: None,
            stiffening: None,
        };
        let ground = Rc::new(RefCell::new(Ground::new(
            self.ground,
            self.mesh.clone(),
            inputs,
            events,
        )?));
        ground_link
            .set(Rc::downgrade(&ground))
            .map_err(|_| io::Error::other("Ground owner already bound"))?;
        ground
            .borrow_mut()
            .bind_water(water.borrow_mut().ground_reconciler());
        Ok(Field {
            mesh: self.mesh.clone(),
            shared: self.shared,
            ground,
            water,
            people: HumanLayers::new(self.people, self.mesh),
            ground_load: self.ground_load,
            sea_load: self.sea_load,
            tectonics: self.tectonics,
            crust_formed: self.crust_formed,
            support_datum: self.support_datum,
            faults: self.faults,
            events: self.events,
            sea_ice_evolved_epoch: self.sea_ice_evolved_epoch,
            last_plate_drift_step: self.last_plate_drift_step,
            province_seams_marked: self.province_seams_marked,
            ecology_initialized: self.ecology_initialized,
            accumulated_plate_drift: self.accumulated_plate_drift,
            landmark_ledger: self.landmark_ledger,
            magic_sources: self.magic_sources,
            transport_plan: None,
            melt_receiver: None,
            human_land_seen: None,
            engineered_dams: None,
            settled_place_targets: std::array::from_fn(|_| None),
            scale,
            thrust_slip: Default::default(),
            coverage: RefCell::new(self.coverage),
        })
    }
}

/// A run contains one set of owners. Read access cannot obtain their mutation capabilities.
/// ```compile_fail
/// use atlas_generation::field::Field;
/// fn bypass(field: &Field) { field.water.borrow_mut().begin_epoch(); }
/// ```
pub struct Field {
    pub(super) mesh: Rc<TriangularLattice>,
    pub(super) shared: SharedFields,
    pub(super) ground: Rc<RefCell<Ground>>,
    pub(super) water: Rc<RefCell<Water>>,
    pub(super) people: HumanLayers,
    pub(super) ground_load: MaterialLoad,
    pub(super) sea_load: MaterialLoad,
    pub(super) tectonics: Option<crate::tectonics::state::State>,
    pub(super) crust_formed: bool,
    pub(super) support_datum: Option<Band<f64>>,
    pub(super) faults: Vec<super::fractures::Fault>,
    pub(super) events: Vec<super::events::Event>,
    pub(super) sea_ice_evolved_epoch: i32,
    pub(super) last_plate_drift_step: f64,
    pub(super) province_seams_marked: bool,
    pub(super) ecology_initialized: bool,
    pub(super) accumulated_plate_drift: f64,
    pub(super) landmark_ledger: Vec<super::landmark_ledger::LandmarkRecord>,
    pub(super) magic_sources: Vec<super::landmarks::magic::Source>,
    pub(super) transport_plan: Option<crate::transport::plan::TransportPlan>,
    pub(super) melt_receiver: Option<super::surface_media::MeltReceiver>,
    pub(super) human_land_seen: Option<super::people::history::Seen>,
    pub(super) engineered_dams: Option<Band<u8>>,
    pub(super) settled_place_targets: [Option<Band<f64>>; 5],
    pub(super) scale: MapScale,
    // hpc-exempt: fractional slip belongs to named thrust sheets, not terrain-cell storage.
    pub(super) thrust_slip: std::collections::BTreeMap<String, f64>,
    pub(super) coverage: RefCell<Coverage>,
}
impl Field {
    pub(crate) fn begin_process(&self) -> u64 {
        self.coverage.borrow().begin_process()
    }
    pub(crate) fn release_process(&self, start: u64) {
        self.coverage.borrow_mut().release_process(start);
    }
    pub fn scale(&self) -> MapScale {
        self.scale
    }
    pub fn question<K: Copy + Ord + 'static>(
        book: Rc<crate::answers::QuestionBook<Self, K>>,
        name: &str,
        key: K,
    ) -> crate::execution::Query<Self, crate::answers::AnswerBand> {
        book.query_in(name, key, |field| &field.coverage)
    }
    pub fn bound_question<K: Copy + Ord + 'static>(
        binding: &crate::answers::QuestionBinding<Self, K>,
        name: &str,
        key: K,
    ) -> crate::execution::Query<Self, crate::answers::AnswerBand> {
        binding.query_in(name, key, |field| &field.coverage)
    }
    pub fn human_operations() -> crate::human::operations::Operations<Self> {
        crate::human::operations::Operations::new(|field| {
            (&mut field.people, field.coverage.get_mut())
        })
    }
    pub fn mesh(&self) -> &TriangularLattice {
        &self.mesh
    }
    pub fn shared(&self) -> &SharedFields {
        &self.shared
    }
    pub fn shared_mut(&mut self) -> &mut SharedFields {
        &mut self.shared
    }
    pub fn ground(&self) -> Ref<'_, Ground> {
        self.ground.borrow()
    }
    pub fn water(&self) -> WaterView {
        self.water.borrow().read_only()
    }
    pub fn people(&self) -> &HumanLayers {
        &self.people
    }
}
