use super::{contract::Entry, kinds::Kind};
use std::io;

/// Which existing use of this site can influence the surrounding settlement.
pub(crate) enum SettlementUse {
    Discontinuity,
    EncroachingWood,
    Burial,
    Floodplain,
    FreshWater,
    Remains,
    FormerDefence,
    Residence,
    NestingGround,
    Learning,
    Guild,
    Refuge,
}

pub(crate) fn settlement_use(feature: &crate::features::Feature) -> Option<SettlementUse> {
    use SettlementUse::*;
    let kind = feature
        .attributes
        .get("poi")
        .and_then(|v| v.as_str())
        .unwrap_or(&feature.kind);
    match kind {
        "tear" | "door" => Some(Discontinuity),
        "greenwoodStand" | "deepwood" => Some(EncroachingWood),
        "ossuary" | "burialGround" => Some(Burial),
        "floodplain" | "floodBasin" => Some(Floodplain),
        "spring" => Some(FreshWater),
        "ruin" => Some(Remains),
        "cityWall"
            if feature.attributes.get("outgrown").and_then(|v| v.as_bool()) == Some(true) =>
        {
            Some(FormerDefence)
        }
        "notableResident" => Some(Residence),
        "rookery" => Some(NestingGround),
        "archive" => Some(Learning),
        "institution" if feature.attributes.contains_key("languageId") => Some(Learning),
        "guild" => Some(Guild),
        "refuge" | "diaspora" => Some(Refuge),
        _ => None,
    }
}

pub trait CatalogueState<Schedule>: super::carry::CarryState<Schedule> {
    fn catalogue(&self) -> &Catalogue<Self, Schedule>;
    fn parent_cell_span(&self) -> f64;
    fn settlement_places(&self) -> io::Result<Vec<super::values::Place>>;
    /// A city map's own places of one kind, each with its published record: walls, gates,
    /// hot-spot places, districts and major works. None on other maps.
    fn city(&self, kind: super::kinds::Kind) -> io::Result<Vec<super::values::Place>>;
}

// Arconis: docs/architecture/subsystems.arconis#item=pp_catalogue — the one place catalogue that classifies and publishes places.
pub struct Catalogue<S, Schedule> {
    entries: Vec<Entry<S, Schedule>>,
    index: Vec<usize>,
}
impl<S, Schedule> Catalogue<S, Schedule> {
    pub fn new(entries: Vec<Entry<S, Schedule>>) -> io::Result<Self> {
        let mut index = vec![usize::MAX; Kind::ALL.len()];
        for (at, entry) in entries.iter().enumerate() {
            if index[entry.id as usize] != usize::MAX {
                return Err(io::Error::other(format!(
                    "Duplicate POI kind: {}",
                    entry.id.as_str()
                )));
            }
            index[entry.id as usize] = at;
        }
        for &kind in Kind::ALL {
            if index[kind as usize] == usize::MAX {
                return Err(io::Error::other(format!(
                    "Missing POI kind: {}",
                    kind.as_str()
                )));
            }
        }
        Ok(Self { entries, index })
    }
    pub fn get(&self, kind: Kind) -> &Entry<S, Schedule> {
        &self.entries[self.index[kind as usize]]
    }
    fn for_feature(&self, feature: &crate::features::Feature) -> Option<&Entry<S, Schedule>> {
        let id = feature
            .attributes
            .get("poi")
            .and_then(|value| value.as_str())
            .unwrap_or(&feature.kind);
        Kind::ALL
            .iter()
            .copied()
            .find(|kind| kind.as_str() == id)
            .map(|kind| self.get(kind))
    }
    pub fn entries(&self) -> &[Entry<S, Schedule>] {
        &self.entries
    }
    pub fn walking_role(
        &self,
        feature: &crate::features::Feature,
    ) -> Option<super::contract::TrailRole> {
        self.for_feature(feature)?.roles.movement.on_foot
    }
    pub fn offers_for<'a>(
        &'a self,
        feature: &'a crate::features::Feature,
    ) -> Option<impl FnOnce(&S, usize) -> io::Result<super::contract::Benefits> + 'a> {
        let entry = self.for_feature(feature)?;
        let offers = entry.roles.people.offers.value()?;
        Some(move |state: &S, cell: usize| {
            let mut place = super::values::Place::at(entry.id, cell, vec![cell]);
            place.id = feature.id.to_string();
            place.feature = Some(feature.clone());
            offers(state, &place)
        })
    }
    pub fn publication_order(&self) -> impl Iterator<Item = &Entry<S, Schedule>> {
        let first = |e: &&Entry<S, Schedule>| {
            e.publication
                .record
                .value()
                .is_some_and(|r| r.publishes_subjects())
        };
        self.entries
            .iter()
            .filter(first)
            .chain(self.entries.iter().filter(move |e| !first(e)))
    }
}
