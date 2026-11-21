use super::{
    classifier::{DenseZone, RuinSite},
    country::Hinterland,
};
use crate::hpc::BitSet;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct History {
    pub era: String,
    pub townsfolk: f64,
    pub people: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub id: String,
    pub anchor: usize,
    pub cells: Vec<usize>,
    pub founded: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abandoned: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tongue: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub absorbed_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adopted: Option<atlas_map::Id>,
    pub town_people: f64,
    pub peak: f64,
    pub people: f64,
    pub built_km2: f64,
    pub works: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hinterland: Option<Hinterland>,
    pub history: Vec<History>,
    /// The realm that nearly holds this town as firmly as its own, in the last era, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contested_by: Option<i32>,
}
pub struct Adopted {
    pub id: atlas_map::Id,
    pub anchor: usize,
    pub cells: Vec<usize>,
    pub founded: String,
    pub town_people: f64,
    pub peak: f64,
    pub abandoned: Option<String>,
    pub history: Vec<History>,
}
// Arconis: docs/architecture/subsystems.arconis#item=pp_places — known towns and ruins; a town keeps its identity.
#[derive(Default, Serialize, Deserialize)]
pub struct Places {
    next: usize,
    pub known: Vec<Place>,
    pub least: f64,
    pub town: f64,
}
impl Place {
    fn new(id: String, anchor: usize, era: &str) -> Self {
        Self {
            id,
            anchor,
            cells: vec![anchor],
            founded: era.into(),
            abandoned: None,
            tongue: None,
            absorbed_by: None,
            adopted: None,
            town_people: 0.0,
            peak: 0.0,
            people: 0.0,
            built_km2: 0.0,
            works: 0.0,
            hinterland: None,
            history: Vec::new(),
            contested_by: None,
        }
    }
    fn shared(&self, ground: &BitSet) -> usize {
        usize::from(ground.has(self.anchor))
            + self
                .cells
                .iter()
                .filter(|&&cell| cell != self.anchor && ground.has(cell))
                .count()
    }
    fn seen(&mut self, zone: &DenseZone, era: &str) {
        self.history.push(History {
            era: era.into(),
            townsfolk: (zone.town_people + 0.5).floor(),
            people: (zone.people + 0.5).floor(),
        });
        self.anchor = zone.anchor;
        self.cells.clone_from(&zone.cells);
        self.town_people = zone.town_people;
        self.people = zone.people;
        self.built_km2 = zone.built_km2;
        self.works = zone.works;
        self.peak = self.peak.max(zone.town_people);
        if self.abandoned.is_some() {
            self.adopted = None;
        }
        self.abandoned = None;
    }
    fn emptied(&mut self, era: &str) {
        self.history.push(History {
            era: era.into(),
            townsfolk: 0.0,
            people: 0.0,
        });
        self.abandoned = Some(era.into());
        self.town_people = 0.0;
        self.people = 0.0;
        self.built_km2 = 0.0;
        self.hinterland = None;
    }
}
impl Places {
    fn founded(&mut self, anchor: usize, era: &str) -> usize {
        let index = self.known.len();
        self.known
            .push(Place::new(format!("place:{}", self.next), anchor, era));
        self.next += 1;
        index
    }
    pub fn recorded(&self) -> bool {
        self.least > 0.0
    }
    pub fn adopt(&mut self, record: Adopted) {
        if self
            .known
            .iter()
            .any(|place| place.adopted == Some(record.id))
        {
            return;
        }
        let index = self.founded(record.anchor, &record.founded);
        let place = &mut self.known[index];
        place.adopted = Some(record.id);
        place.cells = record.cells;
        place.abandoned = record.abandoned.filter(|v| !v.is_empty());
        place.town_people = record.town_people;
        place.peak = record.peak.max(record.town_people);
        place.people = record.town_people;
        place.history = record.history;
    }
    pub fn standing_place<'a>(&'a self, id: &'a str) -> &'a str {
        let mut place = self.known.iter().find(|p| p.id == id);
        while let Some(absorbed) = place.and_then(|p| p.absorbed_by.as_ref()) {
            let Some(next) = self.known.iter().find(|p| p.id == *absorbed) else {
                break;
            };
            place = Some(next);
        }
        place.map_or(id, |p| p.id.as_str())
    }
    fn standing_on(&self, zone: &DenseZone, taken: &[bool], count: usize) -> Vec<usize> {
        let mut ground = BitSet::new(count);
        for &cell in &zone.cells {
            ground.add(cell);
        }
        let mut places: Vec<usize> = self
            .known
            .iter()
            .enumerate()
            .filter(|(i, p)| !taken[*i] && p.absorbed_by.is_none() && p.shared(&ground) > 0)
            .map(|(i, _)| i)
            .collect();
        // hpc-exempt: ranking known named places by shared geography, not ordering numerical cells.
        places.sort_by(|&a, &b| {
            let a = &self.known[a];
            let b = &self.known[b];
            a.abandoned
                .is_none()
                .cmp(&b.abandoned.is_none())
                .then(a.shared(&ground).cmp(&b.shared(&ground)))
                .then(a.peak.total_cmp(&b.peak))
        });
        places.reverse();
        places
    }
    pub fn record(
        &mut self,
        zones: &[DenseZone],
        era: &str,
        least: f64,
        town: f64,
        cell_count: usize,
    ) {
        let mut taken = vec![false; self.known.len() + zones.len()];
        self.least = least;
        self.town = town;
        for zone in zones {
            let held = self.standing_on(zone, &taken, cell_count);
            let place = match held.first().copied() {
                Some(first)
                    if self.known[first].abandoned.is_none() || zone.town_people >= least =>
                {
                    first
                }
                None if zone.town_people >= least => self.founded(zone.anchor, era),
                _ => continue,
            };
            self.known[place].seen(zone, era);
            taken[place] = true;
            let id = self.known[place].id.clone();
            for &other in held.iter().skip(1) {
                if self.known[other].abandoned.is_none() {
                    self.known[other].absorbed_by = Some(id.clone());
                    taken[other] = true;
                }
            }
        }
        for (place, taken) in self.known.iter_mut().zip(taken) {
            if !taken && place.abandoned.is_none() && place.absorbed_by.is_none() {
                place.emptied(era);
            }
        }
    }
    pub fn record_remains(&mut self, sites: &[RuinSite], era: &str, cell_count: usize) {
        let mut stood = BitSet::new(cell_count);
        for place in &self.known {
            stood.add(place.anchor);
            for &cell in &place.cells {
                stood.add(cell);
            }
        }
        for site in sites {
            if site.cells.iter().any(|&cell| stood.has(cell)) {
                continue;
            }
            let index = self.founded(site.anchor, "an earlier age");
            let place = &mut self.known[index];
            place.cells.clone_from(&site.cells);
            place.works = site.works;
            place.tongue = (site.tongue != 0).then_some(site.tongue);
            place.emptied(era);
        }
    }
}
