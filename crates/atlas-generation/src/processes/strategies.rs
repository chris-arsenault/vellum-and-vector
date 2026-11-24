//! Map and metric applicability shared by semantic process owners and the atlas scheduler.
mod applicability;
mod contract;
#[cfg(test)]
mod tests;
pub use applicability::{EffectTime, MapType, Resolution, ScaleBand, Site, Timing};
pub use contract::{Absent, Condition, Contract, NoSource, Product, Source, Strategy};
use serde::Deserialize;
// hpc-exempt: the registry indexes named process declarations by their permanent catalog IDs.
use std::{collections::BTreeMap, io, sync::OnceLock};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
pub enum Kind {
    Algorithm,
    Provider,
    Inherited,
    Coordinator,
    Transferred,
    Deferred,
    NoOp,
    Unspecified,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InputSlot {
    Initial,
    Boundary,
}

#[derive(Deserialize)]
pub struct Scope {
    pub map: MapType,
    pub resolution: Option<ScaleBand>,
    pub reason: Option<String>,
}

// owner-direction(2026-11-23): a named strategy owns its map and metric applicability and each NoOp has a reason
#[derive(Deserialize)]
pub struct Definition {
    pub process: String,
    pub id: String,
    pub kind: Kind,
    pub scopes: Vec<Scope>,
    pub clock: Option<Timing>,
    pub order: Option<u16>,
    pub required: Vec<InputSlot>,
}

impl Definition {
    fn validate(&self) -> io::Result<()> {
        let invalid =
            |detail| io::Error::other(format!("{} / {}: {detail}", self.process, self.id));
        if self.id.trim().is_empty() || self.scopes.is_empty() {
            return Err(invalid("missing strategy ID or applicability"));
        }
        if (self.kind == Kind::Algorithm) != self.clock.is_some()
            || (self.order.is_some() && self.kind != Kind::Algorithm)
        {
            return Err(invalid("invalid clock or composition order"));
        }
        for scope in &self.scopes {
            if self.clock == Some(Timing::Elapsed) && scope.map != MapType::World {
                return Err(invalid(
                    "child refinement cannot advance elapsed world history",
                ));
            }
            if self.kind == Kind::NoOp && !scope.reason.as_deref().is_some_and(substantive) {
                return Err(invalid("NoOp requires a reason for each applicability"));
            }
            if let Some(range) = scope.resolution {
                let (lower, upper, _) = range.endpoints();
                if !lower.is_finite() || !upper.is_finite() || lower < 0.0 || upper <= lower {
                    return Err(invalid("invalid metric interval"));
                }
            } else if self.kind != Kind::Unspecified {
                return Err(invalid("missing metric interval"));
            }
        }
        Ok(())
    }
}

fn substantive(reason: &str) -> bool {
    !matches!(
        reason.trim().to_ascii_lowercase().as_str(),
        "" | "none"
            | "n/a"
            | "noop"
            | "no-op"
            | "inactive"
            | "not applicable"
            | "not scheduled"
            | "tbd"
    )
}

// hpc-exempt: each named process owns a variable number of strategy declarations.
type Catalog = BTreeMap<String, Vec<Definition>>;

fn compile(source: &str) -> io::Result<Catalog> {
    let mut catalog = Catalog::new();
    for strategy in serde_json::from_str::<Vec<Definition>>(source)? {
        strategy.validate()?;
        let entries = catalog.entry(strategy.process.clone()).or_default();
        if entries.iter().any(|other| other.id == strategy.id) {
            return Err(io::Error::other(format!(
                "Duplicate strategy {} / {}",
                strategy.process, strategy.id
            )));
        }
        entries.push(strategy);
    }
    Ok(catalog)
}

pub fn definitions(process: &str) -> io::Result<&'static [Definition]> {
    static CATALOG: OnceLock<Result<Catalog, String>> = OnceLock::new();
    let catalog = CATALOG.get_or_init(|| {
        compile(include_str!(concat!(
            env!("OUT_DIR"),
            "/process-strategies.json"
        )))
        .map_err(|e| e.to_string())
    });
    catalog
        .as_ref()
        .map_err(|message| io::Error::other(message.clone()))?
        .get(process)
        .map(Vec::as_slice)
        .ok_or_else(|| io::Error::other(format!("No strategy catalog for {process}")))
}

pub(crate) fn at(
    definitions: &[Definition],
    site: Site,
    timing: Timing,
) -> io::Result<Vec<&Definition>> {
    let mut selected = Vec::new();
    let mut covered = false;
    for strategy in definitions {
        for scope in &strategy.scopes {
            if scope.map == site.map_type
                && scope
                    .resolution
                    .is_none_or(|band| band.contains(site.cell_metres))
            {
                covered = true;
                if strategy.clock.is_none_or(|clock| clock == timing) {
                    selected.push(strategy);
                }
            }
        }
    }
    if !covered {
        return Err(io::Error::other(format!(
            "Uncovered strategy applicability at {site:?}"
        )));
    }
    // hpc-exempt: explicit composition orders a process's applicable algorithms.
    selected.sort_by_key(|s| s.order);
    for pair in selected.windows(2) {
        if pair[0].order.is_none() || pair[0].order == pair[1].order {
            return Err(io::Error::other(format!(
                "Conflicting applicability for {} / {} and {} at {site:?}",
                pair[0].process, pair[0].id, pair[1].id
            )));
        }
    }
    Ok(selected)
}

/// Membership only changes at interval endpoints. Check those cuts when an owner registers.
pub(crate) fn validate_coverage(definitions: &[Definition]) -> io::Result<()> {
    for &map_type in MapType::ALL {
        let supported = match map_type {
            MapType::World => ScaleBand::World,
            MapType::City | MapType::Region => ScaleBand::Regional,
            MapType::Street => ScaleBand::Street,
        };
        let (lo, hi, _) = supported.endpoints();
        let mut cuts = vec![lo, lo.next_up(), hi];
        for scope in definitions
            .iter()
            .flat_map(|d| &d.scopes)
            .filter(|s| s.map == map_type)
        {
            if let Some(band) = scope.resolution {
                let (lo, hi, _) = band.endpoints();
                cuts.extend([lo, lo.next_up(), hi, hi.next_up()]);
            }
        }
        for cell_metres in cuts.into_iter().filter(|m| supported.contains(*m)) {
            let site = Site {
                map_type,
                cell_metres,
            };
            at(definitions, site, Timing::Elapsed)?;
            at(definitions, site, Timing::Present)?;
        }
    }
    Ok(())
}
