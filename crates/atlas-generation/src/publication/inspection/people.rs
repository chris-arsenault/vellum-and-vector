use super::{
    format::{percent, round},
    record, section, Cell,
};
use crate::{
    human::identity::IDENTITY_SLOTS,
    scale::{AreaUnit, MapScale},
};
use atlas_map::InspectionSection;
use serde_json::Value;
// hpc-exempt: map inspection descriptions, never terrain-cell computation state.
use std::{collections::BTreeMap, io};

pub fn sections(cell: &Cell<'_>) -> io::Result<Vec<InspectionSection>> {
    if !cell.population {
        return Ok(Vec::new());
    }
    let density = (cell.read)("Population")?;
    if density <= 0.0 && (cell.read)("RuinedBuiltUp")? <= 0.0 {
        return Ok(vec![section(
            "people",
            "People here",
            vec![record([(
                "Description",
                "Nobody lives on this cell and nothing built remains on it.".into(),
            )])],
        )]);
    }
    let mut sections = vec![section("people", "People here", land_use(cell)?)];
    let identity = identity(cell, density)?;
    if !identity.is_empty() {
        sections.push(section(
            "identity",
            "Who they are, newest layer first",
            identity,
        ));
    }
    Ok(sections)
}
// hpc-exempt: named columns in stored GIS descriptions or explicit inspection fixtures, not field state.
fn land_use(cell: &Cell<'_>) -> io::Result<Vec<BTreeMap<String, Value>>> {
    let density = (cell.read)("Population")?;
    let area = MapScale::area_units(
        cell.measure,
        AreaUnit::SquareMetre,
        AreaUnit::SquareKilometre,
    );
    let mut facts = vec![
        (
            "People",
            format!(
                "{} per km² · about {} on this cell",
                round(density),
                round(density * area)
            ),
        ),
        ("Farmland", percent((cell.read)("Farmland")?)),
        ("Pasture", percent((cell.read)("Pasture")?)),
        ("Built-up ground", percent((cell.read)("BuiltUp")?)),
        (
            "Works and wealth",
            format!("{} person-years per km²", round((cell.read)("Standing")?)),
        ),
    ];
    let ruined = (cell.read)("RuinedBuiltUp")?;
    if ruined > 0.0 {
        facts.push((
            "Ruins",
            format!(
                "{} of the ground, {} of them buried or drowned",
                percent(ruined),
                percent((cell.read)("RuinCover")?)
            ),
        ));
    }
    Ok(facts
        .into_iter()
        .map(|(fact, value)| record([("Fact", fact.into()), ("Value", value)]))
        .collect())
}
// hpc-exempt: named columns in stored GIS descriptions or explicit inspection fixtures, not field state.
fn identity(cell: &Cell<'_>, density: f64) -> io::Result<Vec<BTreeMap<String, Value>>> {
    let mut records = Vec::new();
    for slot in 0..IDENTITY_SLOTS {
        let people = (cell.read)(&format!("IdentityPeople{slot}"))?;
        if people <= 0.0 {
            continue;
        }
        let mut names = Vec::new();
        for (tradition, word) in [
            ("Tongue", "tongue"),
            ("Faith", "faith"),
            ("Custom", "custom"),
            ("Allegiance", "realm"),
            ("Craft", "craft"),
        ] {
            let channel = format!("Identity{tradition}{slot}");
            let code = (cell.read)(&channel)?;
            if code > 0.0 {
                names.push(format!("{word}: {}", cell.class(&channel, code)));
            }
        }
        records.push(record([
            (
                "Traditions",
                if names.is_empty() {
                    "no named tradition".into()
                } else {
                    names.join(" · ")
                },
            ),
            (
                "Share of people",
                if density > 0.0 {
                    percent((people / density).min(1.0))
                } else {
                    "—".into()
                },
            ),
            (
                "Age",
                format!(
                    "{} years",
                    round((cell.read)(&format!("IdentityAge{slot}"))?)
                ),
            ),
            (
                "Holds against change",
                percent((cell.read)(&format!("IdentityHardness{slot}"))?),
            ),
        ]));
    }
    Ok(records)
}
