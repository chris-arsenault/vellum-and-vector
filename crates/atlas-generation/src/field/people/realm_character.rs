//! A realm's character, read from its people when the map is published: how many it holds,
//! the word its name ends in, and whether it still holds what it claims. The old society
//! cycle named a realm by a magic practice a third of its people kept, else a livelihood half
//! of them lived by, else the breadth of its tongues.
use super::{crafts, places::Place, work::km2};
use crate::{
    field::Field,
    human::{
        catalogue::LayerId,
        identity::{held, Tradition},
        HumanField,
    },
    storage::ReadBand,
};
use std::io;

/// The share of a realm's people who must keep a craft for the realm to be named by it.
const CRAFT_KEPT: f64 = 1.0 / 3.0;
/// The share who must live by a livelihood for the realm to be named by it.
const LIVING_BY: f64 = 0.5;
/// The share who must speak or know a tongue for it to count among the realm's tongues.
const IN_COMMON: f64 = 0.1;
/// How many tongues in common make a realm a concord.
const CONCORD: usize = 3;
/// How much of a cell's living a fully coastal cell's people take from the sea, and how much of
/// it unworked ground gives, beside its farmland and pasture.
const FISHERS: f64 = 0.5;
const GATHERERS: f64 = 0.05;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Livelihood {
    Farming,
    Grazing,
    Fishing,
    Gathering,
}
impl Livelihood {
    const ALL: [Self; 4] = [Self::Farming, Self::Grazing, Self::Fishing, Self::Gathering];
    fn term(self) -> &'static str {
        match self {
            Self::Farming => "Commonwealth",
            Self::Grazing => "Horde",
            Self::Fishing => "League",
            Self::Gathering => "Confederacy",
        }
    }
}
/// What a realm's people keep and live by, as shares of its people.
#[derive(Default)]
pub struct Keeping {
    pub crafts: Vec<(i32, f64)>,
    pub livelihoods: [f64; 4],
    pub tongues: usize,
}
pub struct Character {
    pub people: f64,
    pub places: usize,
    pub term: &'static str,
    pub status: &'static str,
}
/// The word a realm's name ends in.
pub fn term(keeping: &Keeping) -> &'static str {
    let craft = keeping
        .crafts
        .iter()
        .filter(|(_, share)| *share >= CRAFT_KEPT)
        .max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.cmp(&a.0)))
        .and_then(|(code, _)| crafts::by_code(*code));
    if let Some(craft) = craft {
        return craft.realm_term;
    }
    let living = Livelihood::ALL
        .into_iter()
        .zip(keeping.livelihoods)
        .filter(|(_, share)| *share >= LIVING_BY)
        .max_by(|a, b| a.1.total_cmp(&b.1));
    if let Some((livelihood, _)) = living {
        return livelihood.term();
    }
    if keeping.tongues >= CONCORD {
        "Concord"
    } else {
        "Commonwealth"
    }
}
/// A realm that holds none of the places it claims has collapsed; one holding fewer than half
/// of them is fragmented, as the old society cycle judged its realms.
pub fn status(controlled: usize, claimed: usize) -> &'static str {
    if controlled == 0 {
        "collapsed"
    } else if 2 * controlled < claimed {
        "fragmented"
    } else {
        "active"
    }
}
/// A realm's name with the word it ends in made `term`.
pub fn renamed(name: &str, term: &str) -> String {
    match name.rsplit_once(' ') {
        Some((stem, _)) => format!("{stem} {term}"),
        None => format!("{name} {term}"),
    }
}
fn livelihoods(field: &Field, cell: usize) -> io::Result<[f64; 4]> {
    let farmland = field.people.view(HumanField::Layer(LayerId::Farmland)).get(cell)?;
    let pasture = field.people.view(HumanField::Layer(LayerId::Pasture)).get(cell)?;
    let water = field.water.borrow().kinds();
    let mut seas = 0.0;
    for edge in 0..3 {
        if let Some(next) = field.mesh.neighbor(cell, edge) {
            if water.get(next)? == 1 {
                seas += 1.0 / 3.0;
            }
        }
    }
    let ways = [farmland, pasture, FISHERS * seas, GATHERERS];
    let all: f64 = ways.iter().sum();
    Ok(ways.map(|way| way / all))
}
fn keeping(field: &Field, claimed: &ReadBand<f64>) -> io::Result<(f64, Keeping)> {
    let mut people = 0.0;
    let mut keeping = Keeping::default();
    let mut tongues: Vec<(i32, f64)> = Vec::new();
    let add = |list: &mut Vec<(i32, f64)>, code: i32, amount: f64| {
        match list.iter_mut().find(|(c, _)| *c == code) {
            Some(entry) => entry.1 += amount,
            None => list.push((code, amount)),
        }
    };
    for cell in 0..field.mesh.len() {
        let share = claimed.get(cell)?;
        let here = field.people.people(cell)? * km2(field, cell);
        if share <= 0.0 || here <= 0.0 {
            continue;
        }
        let weight = share * here;
        people += weight;
        let column = field.people.column(cell)?;
        let everyone: f64 = column.iter().map(|layer| layer.people).sum::<f64>().max(f64::EPSILON);
        for (code, holding) in held(&column, Tradition::Craft) {
            add(&mut keeping.crafts, code, weight * holding / everyone);
        }
        for tradition in [Tradition::Tongue, Tradition::Known] {
            for (code, holding) in held(&column, tradition) {
                add(&mut tongues, code, weight * holding / everyone);
            }
        }
        for (into, way) in keeping.livelihoods.iter_mut().zip(livelihoods(field, cell)?) {
            *into += weight * way;
        }
    }
    let whole = people.max(f64::EPSILON);
    for entry in &mut keeping.crafts {
        entry.1 /= whole;
    }
    for way in &mut keeping.livelihoods {
        *way /= whole;
    }
    keeping.tongues = tongues
        .iter()
        .filter(|(code, amount)| *code != 0 && amount / whole >= IN_COMMON)
        .count();
    Ok((people, keeping))
}
/// The character of the realm `code`, whose claim on each cell is `claimed` and which leads
/// the cells where `leads` names it.
pub fn character(
    field: &Field,
    code: i32,
    claimed: &ReadBand<f64>,
    leads: &[i32],
    places: &[Place],
) -> io::Result<Character> {
    let (people, keeping) = keeping(field, claimed)?;
    let (mut controlled, mut claims) = (0, 0);
    for place in places
        .iter()
        .filter(|p| p.abandoned.is_none() && p.absorbed_by.is_none())
    {
        if claimed.get(place.anchor)? > 0.0 {
            claims += 1;
        }
        if leads[place.anchor] == code {
            controlled += 1;
        }
    }
    Ok(Character {
        people,
        places: controlled,
        term: term(&keeping),
        status: status(controlled, claims),
    })
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_realm_is_named_by_a_craft_a_third_keep_before_its_livelihood_or_tongues() {
        let mut keeping = Keeping {
            crafts: vec![(1, 0.4), (3, 0.2)],
            livelihoods: [0.6, 0.2, 0.1, 0.1],
            tongues: 4,
        };
        assert_eq!(term(&keeping), "Hold");
        keeping.crafts = vec![(1, 0.2)];
        assert_eq!(term(&keeping), "Commonwealth");
        keeping.livelihoods = [0.2, 0.7, 0.0, 0.1];
        assert_eq!(term(&keeping), "Horde");
        keeping.livelihoods = [0.3, 0.3, 0.3, 0.1];
        assert_eq!(term(&keeping), "Concord");
        keeping.tongues = 1;
        assert_eq!(term(&keeping), "Commonwealth");
    }
    #[test]
    fn a_realm_holding_under_half_its_claims_is_fragmented_and_none_collapsed() {
        assert_eq!(status(0, 4), "collapsed");
        assert_eq!(status(1, 4), "fragmented");
        assert_eq!(status(2, 4), "active");
    }
    #[test]
    fn renaming_changes_only_the_last_word() {
        assert_eq!(renamed("Vash Taro Commonwealth", "League"), "Vash Taro League");
    }
}
