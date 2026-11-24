use crate::processes::strategies::{Contract, EffectTime, Product, Site, Source, Timing};
use std::{io, num::NonZeroUsize, panic::Location, rc::Rc};

// owner-direction(2026-11-23): exactly Semantic, ClassificationPublication and LegacyUnmigrated are registered process categories
#[derive(Clone)]
pub enum Category {
    Semantic(Semantic),
    ClassificationPublication,
    LegacyUnmigrated(Legacy),
}

impl Category {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Semantic(_) => "Semantic",
            Self::ClassificationPublication => "ClassificationPublication",
            Self::LegacyUnmigrated(_) => "LegacyUnmigrated",
        }
    }
}

#[derive(Clone, Copy)]
pub struct Legacy {
    pub declared_at: &'static Location<'static>,
}

#[derive(Clone, Copy, Debug)]
pub struct Selected {
    pub process_id: &'static str,
    pub name: &'static str,
    pub time: EffectTime,
}

type Selector = dyn Fn(Site, Timing) -> io::Result<Vec<Selected>>;

/// Both recipe review and executable registration use this owner and its scheduling slot.
/// Ledger facts express readiness between scheduled calls. A process can also read optional
/// evidence or consult a shared question without making it a prerequisite for execution.
pub struct SemanticRegistration<A: 'static, I: Source + 'static, B: Source + 'static> {
    pub owner: Contract<A, I, B>,
    pub module: &'static str,
    pub schedule: Schedule,
    pub requires: &'static str,
    pub produces: &'static str,
}

impl<A: Copy, I: Copy + Source, B: Copy + Source> SemanticRegistration<A, I, B> {
    pub fn specification(&self) -> super::Specification {
        let mut spec = super::Specification::new(self.owner.id, self.requires, self.produces, true)
            .scheduled(self.module, self.schedule);
        spec.category = Category::Semantic(Semantic::new(self.owner));
        spec
    }
}

#[derive(Clone)]
pub struct Semantic {
    pub effect: &'static str,
    pub reads: &'static [Product],
    pub writes: &'static [Product],
    select: Rc<Selector>,
    pub(super) validate: Rc<dyn Fn() -> io::Result<()>>,
}

impl Semantic {
    pub(super) fn new<A: Copy + 'static, I: Source + Copy + 'static, B: Source + Copy + 'static>(
        owner: Contract<A, I, B>,
    ) -> Self {
        Self {
            effect: owner.effect,
            reads: owner.reads,
            writes: owner.writes,
            validate: Rc::new(move || owner.validate()),
            select: Rc::new(move |site, timing| {
                Ok(owner
                    .select(site, timing)?
                    .into_iter()
                    .map(|strategy| Selected {
                        process_id: owner.catalog_id,
                        name: strategy.name,
                        time: strategy.time,
                    })
                    .collect())
            }),
        }
    }

    pub(super) fn select(&self, site: Site, elapsed: bool) -> io::Result<Vec<Selected>> {
        (self.select)(
            site,
            if elapsed {
                Timing::Elapsed
            } else {
                Timing::Present
            },
        )
    }
}

/// An unnamed slot keeps the recipe's existing causal order. Neighbouring calls in a
/// named stage share a slot and use their declared order within it.
#[derive(Clone, Copy, Default)]
pub struct Schedule {
    pub stage: Option<&'static str>,
    pub order: i32,
    pub after: &'static [&'static str],
    pub feedback: Option<Feedback>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Feedback {
    pub name: &'static str,
    pub iterations: NonZeroUsize,
}
