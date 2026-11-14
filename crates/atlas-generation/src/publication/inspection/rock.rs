use super::{
    format::{metres, percent, round},
    record, section, Cell,
};
use crate::rock::columns::Column;
use atlas_map::InspectionSection;
use serde_json::Value;
// hpc-exempt: formatted inspection attribute records, not simulation state.
use std::{collections::BTreeMap, io};

pub fn sections(cell: &Cell<'_>) -> io::Result<Vec<InspectionSection>> {
    let mut intact = column(cell, Column::Loose, "LooseLayer")?;
    intact.extend(column(cell, Column::Land, "RockLayer")?);
    let mut valley = column(cell, Column::CutLoose, "LooseCutLayer")?;
    valley.extend(column(cell, Column::Cut, "RockCutLayer")?);
    let mut sections = Vec::new();
    if intact.is_empty() && valley.is_empty() {
        return Ok(sections);
    }
    let cut = (cell.read)("GroundCutShare")?;
    if cut > 0.0 {
        sections.push(section(
            "valleys",
            "Valleys",
            vec![record([
                ("Share of ground", percent(cut)),
                ("Depth", metres((cell.read)("GroundCutDepth")?)),
            ])],
        ));
    }
    if !intact.is_empty() {
        sections.push(section(
            "ground-column",
            if cut > 0.0 {
                "Under the uncut ground"
            } else {
                "Under this ground"
            },
            intact,
        ));
    }
    if cut > 0.0 && !valley.is_empty() {
        sections.push(section("valley-column", "Under the valley floors", valley));
    }
    Ok(sections)
}
fn column(
    cell: &Cell<'_>,
    column: Column,
    prefix: &str,
    // hpc-exempt: named columns in stored GIS descriptions or explicit inspection fixtures, not field state.
) -> io::Result<Vec<BTreeMap<String, Value>>> {
    let mut records = Vec::new();
    for slot in 0..column.size() {
        let channel = |property: &str| format!("{prefix}{property}{slot}");
        let read = |property: &str| (cell.read)(&channel(property));
        let depth = read("Depth")?;
        if depth <= 0.0 {
            continue;
        }
        let kind = cell.class(&channel("Kind"), read("Kind")?);
        let second = read("SecondaryShare")?;
        let name = if second > 0.0 {
            format!(
                "{kind} with {} {}",
                percent(second),
                cell.class(&channel("SecondaryKind"), read("SecondaryKind")?)
                    .to_lowercase()
            )
        } else {
            kind
        };
        let from = read("FormedMin")?;
        let to = read("FormedMax")?;
        records.push(record([
            ("Layer, top first", name),
            ("Thickness", metres(depth)),
            ("Strength", round(read("Strength")?)),
            ("Fractured", percent(read("Damage")?)),
            (
                "Formed",
                if from == to {
                    format!("epoch {from}")
                } else {
                    format!("epochs {from}–{to}")
                },
            ),
        ]));
    }
    Ok(records)
}
