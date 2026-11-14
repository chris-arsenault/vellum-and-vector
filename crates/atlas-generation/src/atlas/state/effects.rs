//! Maintained places use owner commands; refreshing water answers performs no material work.
use super::State;
use crate::{
    execution::{Command, CommandKind},
    field::{
        contributions::{Contributions, Medium},
        people::land_events::Struck,
        poi::{
            carry, costs,
            effect_declarations::{self, Changes, Declared, WaterInfluences},
            effects::{self, MagicContributions, Operations},
            publication::places_of,
            reads::has_channel,
            values::Carrier,
        },
        shared::Scalar,
        Field,
    },
    magic::{carriers::Costs, state::MagicField},
};
use std::{cell::RefCell, io, rc::Rc};

pub(super) struct Memory {
    water: Rc<RefCell<WaterInfluences>>,
    grades: Option<Changes>,
    magic: MagicContributions,
    ledger: Contributions,
}
impl Memory {
    pub fn new(field: &Field) -> Self {
        Self {
            water: Rc::new(RefCell::new(WaterInfluences::for_field(field))),
            grades: None,
            magic: MagicContributions::default(),
            ledger: Contributions::default(),
        }
    }
}
struct Work<'a> {
    declared: &'a Declared,
    ledger: RefCell<&'a mut Contributions>,
    applied_magic: RefCell<&'a mut MagicContributions>,
    magic: RefCell<&'a mut [MagicField]>,
}
fn declare_operation<'a>() -> Command<Field, Work<'a>> {
    let operations = Operations::new();
    Command::with_inputs(
        "places.declare",
        CommandKind::Work,
        vec![],
        move |context, input: &Work<'_>| {
            operations.declare(context, input.declared, &mut input.ledger.borrow_mut())?;
            input.applied_magic.borrow_mut().apply(
                context.state_mut(),
                &mut input.magic.borrow_mut(),
                input.declared,
            )?;
            Ok(())
        },
    )
}
impl State {
    pub fn place_water(&self) -> Rc<RefCell<WaterInfluences>> {
        self.place_effects.water.clone()
    }

    fn declared_places(&self, water_only: bool) -> io::Result<Declared> {
        self.clear_queries();
        let carried = if self.regional.is_some() {
            Some(carry::carried_places(self, &self.catalogue)?)
        } else {
            None
        };
        effect_declarations::declare(
            self,
            &self.catalogue,
            |entry| Ok(places_of(self, entry)?.as_ref().clone()),
            carried
                .iter()
                .flat_map(|p| p.iter())
                .map(|p| (self.catalogue.get(p.kind), &p.carried)),
            Some(&mut self.place_effects.water.borrow_mut()),
            water_only,
        )
    }
    pub fn refresh_place_influences(&self) -> io::Result<()> {
        self.declared_places(true)?;
        Ok(())
    }
    pub fn apply_place_event(&mut self, event: &Struck) -> io::Result<()> {
        let changes = effects::event_changes(&self.catalogue, self, event)?;
        let operations = Operations::new();
        let command = Command::with_inputs(
            "places.event",
            CommandKind::Work,
            vec![],
            move |context, changes: &Vec<_>| operations.event(context, changes),
        );
        self.physical
            .executor
            .run_with(&command, &changes)
            .map_err(|e| io::Error::other(format!("{e:?}")))?;
        Ok(())
    }
    pub(super) fn carrier_costs(&self) -> io::Result<Costs> {
        let band = |carrier| {
            costs::carrier_band(
                self.field(),
                &costs::carrier_factors(self, &self.catalogue, carrier, |entry| {
                    Ok(places_of(self, entry)?.as_ref().clone())
                })?,
            )
        };
        Ok(Costs {
            crust: Some(band(Carrier::Crust)?),
            roots: Some(band(Carrier::Roots)?),
            ice: Some(band(Carrier::Ice)?),
            river: Some(band(Carrier::River)?),
            wind: Some(band(Carrier::Wind)?),
        })
    }
    pub fn declare_place_effects(&mut self, ledger: &mut Contributions) -> io::Result<()> {
        let declared = self.declared_places(false)?;
        {
            let input = Work {
                declared: &declared,
                ledger: RefCell::new(ledger),
                applied_magic: RefCell::new(&mut self.place_effects.magic),
                magic: RefCell::new(
                    self.physical
                        .magic
                        .as_mut()
                        .map_or(&mut [], |magic| magic.get_mut().fields.as_mut_slice()),
                ),
            };
            self.physical
                .executor
                .run_with(&declare_operation(), &input)
                .map_err(|e| io::Error::other(format!("{e:?}")))?;
        }
        self.place_effects.grades = Some(declared.grades);
        if self.physical.magic.is_some() {
            let costs = self.carrier_costs()?;
            if let Some(magic) = &mut self.physical.magic {
                magic.get_mut().carrier_costs = costs;
            }
        }
        self.clear_queries();
        Ok(())
    }
    pub fn apply_place_effects(&mut self) -> io::Result<()> {
        let mut ledger = std::mem::take(&mut self.place_effects.ledger);
        let result = (|| {
            ledger.begin()?;
            for band in [
                Scalar::Temperature,
                Scalar::Moisture,
                Scalar::Rainfall,
                Scalar::Slope,
            ] {
                ledger.forget(Medium::Shared(band));
            }
            self.declare_place_effects(&mut ledger)?;
            self.commit_place_contributions(&mut ledger)
        })();
        self.place_effects.ledger = ledger;
        result
    }
    pub(super) fn commit_place_contributions(
        &mut self,
        ledger: &mut Contributions,
    ) -> io::Result<()> {
        let commit = Command::with_inputs(
            "places.commit",
            CommandKind::Work,
            vec![],
            |context, ledger: &RefCell<&mut Contributions>| {
                ledger
                    .borrow_mut()
                    .commit(context.state_mut(), Medium::bounds)?;
                Ok(())
            },
        );
        self.physical
            .executor
            .run_with(&commit, &RefCell::new(ledger))
            .map_err(|e| io::Error::other(format!("{e:?}")))
    }
    pub fn grade_places(&mut self) -> io::Result<()> {
        if self.regional.is_none() {
            return Err(io::Error::other("Place grading requires a regional map"));
        }
        self.clear_queries();
        let initial = if self.place_effects.grades.is_none() {
            let carried = carry::carried_places(self, &self.catalogue)?;
            Some(
                effect_declarations::carried(
                    self,
                    carried
                        .iter()
                        .map(|p| (self.catalogue.get(p.kind), &p.carried)),
                )?
                .grades,
            )
        } else {
            None
        };
        self.clear_queries();
        let grades = self
            .place_effects
            .grades
            .as_ref()
            .or(initial.as_ref())
            .unwrap();
        let channel = (0..self.field().mesh().len())
            .map(|cell| has_channel(self.field(), cell).map(u8::from))
            .collect::<io::Result<Vec<_>>>()?;
        let empty = vec![0; channel.len()];
        let basin = self
            .regional
            .as_ref()
            .unwrap()
            .basin
            .as_deref()
            .unwrap_or(&empty);
        let command = Command::with_inputs(
            "places.grade",
            CommandKind::Work,
            vec![],
            |context, input: &(&Changes, &[u8], &[u8])| {
                effects::grade_places(context.state_mut(), input.0, input.1, input.2)?;
                Ok(())
            },
        );
        self.physical
            .executor
            .run_with(&command, &(grades, channel.as_slice(), basin))
            .map_err(|e| io::Error::other(format!("{e:?}")))?;
        Ok(())
    }
}
