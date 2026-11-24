use super::{at, definitions, validate_coverage, EffectTime, InputSlot, Kind, Site, Timing};
use crate::human::catalogue::LayerId;
use std::io;

/// Every active strategy must say how it starts and whether it takes boundary input.
///
/// ```compile_fail
/// use atlas_generation::processes::strategies::{Condition, EffectTime, Strategy};
/// let _: Strategy<()> = Strategy {
///     name: "read a place",
///     time: EffectTime::Present,
///     slot: "after population",
///     boundary: Condition::None,
///     algorithm: (),
/// };
/// ```
///
/// ```compile_fail
/// use atlas_generation::processes::strategies::{Condition, EffectTime, Strategy};
/// let _: Strategy<()> = Strategy {
///     name: "read a place",
///     time: EffectTime::Present,
///     slot: "after population",
///     initial: Condition::None,
///     algorithm: (),
/// };
/// ```
#[derive(Clone, Copy)]
pub struct Strategy<A, I: Source = NoSource, B: Source = NoSource> {
    pub name: &'static str,
    pub time: EffectTime,
    pub slot: &'static str,
    pub initial: Condition<I>,
    pub boundary: Condition<B>,
    pub algorithm: A,
}

/// Address shared inputs and effects using the owning field, question, work or record.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Product {
    Layer(LayerId),
    Question(&'static str),
    Travel,
    ParentDonors,
    OutsideFood,
    NetFoodImports,
    FoodShortfall,
    TravelLinks,
    Language,
    CapturedSettlements,
    SettlementRecords,
    Roads,
    RoadWear,
    GroundHazards,
    WatchedGround,
    CityBlocks,
    Districts,
    Premises,
    OpenSpace,
}

/// The type of input a process receives is determined by the source it declares.
pub trait Source {
    type Value;
}

#[derive(Clone, Copy)]
pub enum NoSource {}
impl Source for NoSource {
    type Value = std::convert::Infallible;
}

/// Inapplicability is explicit. A declared source can itself lack evidence.
#[derive(Clone, Copy)]
pub enum Condition<S: Source> {
    None,
    From { source: S, absent: Absent },
}

#[derive(Clone, Copy)]
pub enum Absent {
    Error(&'static str),
    Empty,
}

impl<S: Source> Condition<S> {
    pub fn source(self) -> Option<S> {
        match self {
            Self::None => None,
            Self::From { source, .. } => Some(source),
        }
    }

    pub fn bind(
        self,
        provide: impl FnOnce(S) -> io::Result<Option<S::Value>>,
    ) -> io::Result<Option<S::Value>> {
        let Self::From { source, absent } = self else {
            return Ok(None);
        };
        let value = provide(source)?;
        if let (None, Absent::Error(message)) = (&value, absent) {
            return Err(io::Error::other(message));
        }
        Ok(value)
    }
}

// owner-direction(2026-11-22): each process implements the process contract in an extensible manner
#[derive(Clone, Copy)]
pub struct Contract<A: 'static, I: Source + 'static = NoSource, B: Source + 'static = NoSource> {
    pub id: &'static str,
    pub effect: &'static str,
    pub reads: &'static [Product],
    pub writes: &'static [Product],
    /// Permanent workbook identity, including for processes registered under a renamed command.
    pub catalog_id: &'static str,
    pub strategies: &'static [Strategy<A, I, B>],
}

impl<A: Copy, I: Source + Copy, B: Source + Copy> Contract<A, I, B> {
    pub(crate) fn binding(&self, id: &str) -> io::Result<Strategy<A, I, B>> {
        self.strategies
            .iter()
            .find(|s| s.name == id)
            .copied()
            .ok_or_else(|| {
                io::Error::other(format!("{} has no algorithm binding for {id}", self.id))
            })
    }

    pub(crate) fn validate(&self) -> io::Result<()> {
        let catalog = definitions(self.catalog_id)?;
        for definition in catalog {
            match definition.kind {
                Kind::Algorithm => {
                    let algorithm = self.binding(&definition.id)?;
                    algorithm.validate(definition)?;
                }
                Kind::Unspecified | Kind::Deferred => {
                    return Err(io::Error::other(format!(
                        "{} / {} is {:?}",
                        self.id, definition.id, definition.kind
                    )))
                }
                Kind::Transferred | Kind::Coordinator => {
                    return Err(io::Error::other(format!(
                        "{} / {} belongs to {:?}, outside semantic execution",
                        self.id, definition.id, definition.kind
                    )));
                }
                _ => {}
            }
        }
        for (i, strategy) in self.strategies.iter().enumerate() {
            if self.strategies[..i].iter().any(|s| s.name == strategy.name)
                || !catalog
                    .iter()
                    .any(|d| d.kind == Kind::Algorithm && d.id == strategy.name)
            {
                return Err(io::Error::other(format!(
                    "Unmatched or duplicate algorithm {} / {}",
                    self.id, strategy.name
                )));
            }
        }
        validate_coverage(catalog)
    }

    pub fn select(&self, site: Site, timing: Timing) -> io::Result<Vec<Strategy<A, I, B>>> {
        let mut algorithms = Vec::new();
        for definition in at(definitions(self.catalog_id)?, site, timing)? {
            match definition.kind {
                Kind::Algorithm => algorithms.push(self.binding(&definition.id)?),
                Kind::Unspecified | Kind::Deferred => {
                    return Err(io::Error::other(format!(
                        "{} / {} is {:?}",
                        self.id, definition.id, definition.kind
                    )))
                }
                _ => {}
            }
        }
        Ok(algorithms)
    }
}

impl<A, I: Source + Copy, B: Source + Copy> Strategy<A, I, B> {
    pub(super) fn validate(&self, definition: &super::Definition) -> io::Result<()> {
        for slot in &definition.required {
            let bound = match slot {
                InputSlot::Initial => self.initial.source().is_some(),
                InputSlot::Boundary => self.boundary.source().is_some(),
            };
            if !bound {
                return Err(io::Error::other(format!(
                    "Missing {slot:?} binding for {} / {}",
                    definition.process, definition.id
                )));
            }
        }
        if definition.clock != Some(self.time.clock()) {
            return Err(io::Error::other(format!(
                "Invalid clock for {} / {}",
                definition.process, definition.id
            )));
        }
        Ok(())
    }
}
