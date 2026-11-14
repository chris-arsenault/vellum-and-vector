use super::{
    canyon::length,
    capture::water_at,
    catalogue::{Kind, Measures},
    terrain::{base_height, height, reaches_sea, relief, step_down, within, Terrain},
};
use crate::{
    field::shared::{CellCode as C, Scalar as S},
    scale::{LengthUnit, MapScale},
    water::column::Store,
};
use std::io;
pub struct Site {
    pub center: usize,
    pub path: Vec<[f64; 2]>,
}
pub fn assess(t: &Terrain<'_>, kind: Kind, cell: usize, p: &Measures) -> io::Result<Option<f64>> {
    match kind {
        Kind::VolcanicMountain | Kind::ResistantMountain => {
            mountain(t, cell, p, kind == Kind::VolcanicMountain)
        }
        Kind::DomeRing | Kind::ImpactRing => ring(t, cell, p, kind == Kind::ImpactRing),
        Kind::Escarpment => scarp(t, cell, p),
        Kind::Canyon => canyon(t, cell, p),
        Kind::Falls => falls(t, cell, p),
        _ => magic(t, kind, cell),
    }
}
fn mountain(t: &Terrain<'_>, cell: usize, p: &Measures, volcanic: bool) -> io::Result<Option<f64>> {
    let field = t.field;
    let radius = MapScale::metres(p["baseRadius"], LengthUnit::Kilometre);
    let limit = length(field, if volcanic { 0.0001 } else { 0.000075 })?;
    let ceiling = length(field, if volcanic { 0.000375 } else { 0.00025 })?;
    let h = height(field, cell)?;
    if t.sea.get(cell)? < 1.5 * radius || h < 0.0 || h > ceiling {
        return Ok(None);
    }
    let rough = relief(field, &within(field, cell, radius))?;
    if rough > limit {
        return Ok(None);
    }
    let heat = if volcanic {
        0.3 * (field.shared.scalar(S::HeatSourceDensity).get(cell)? / 500.0).min(1.0)
    } else {
        0.0
    };
    Ok(Some(1.0 - rough / limit + 0.5 * (1.0 - h / ceiling) + heat))
}
fn ring(t: &Terrain<'_>, cell: usize, p: &Measures, impact: bool) -> io::Result<Option<f64>> {
    let field = t.field;
    let radius = MapScale::metres(p["diameter"], LengthUnit::Kilometre) / 2.0;
    let limit = length(field, if impact { 0.000125 } else { 0.0000375 })?;
    let h = height(field, cell)?;
    if t.sea.get(cell)? < if impact { radius } else { 1.5 * radius }
        || h < 0.0
        || (!impact && h > length(field, 0.0003)?)
    {
        return Ok(None);
    }
    let rough = relief(field, &within(field, cell, radius))?;
    if rough > limit {
        return Ok(None);
    }
    let bonus = if impact {
        0.3 * (1.0 - (h / length(field, 0.0005)?).min(1.0))
    } else {
        0.5 * (1.0 - field.shared.scalar(S::Moisture).get(cell)?.min(1000.0) / 1000.0)
    };
    Ok(Some(1.0 - rough / limit + bonus))
}
fn scarp(t: &Terrain<'_>, cell: usize, p: &Measures) -> io::Result<Option<f64>> {
    let field = t.field;
    let width = MapScale::metres(p["scarpWidth"], LengthUnit::Kilometre);
    let h = height(field, cell)?;
    if t.sea.get(cell)? < 2.0 * width || h < length(field, 0.000075)? {
        return Ok(None);
    }
    let (_, drop) = t.downhill(cell, 3.0 * width)?;
    Ok(if drop < length(field, 0.0000375)? {
        None
    } else {
        Some(drop / length(field, 0.00025)? + h / length(field, 0.00075)?)
    })
}
fn canyon(t: &Terrain<'_>, cell: usize, p: &Measures) -> io::Result<Option<f64>> {
    let field = t.field;
    let width = MapScale::metres(p["rimWidth"], LengthUnit::Kilometre);
    if height(field, cell)? < length(field, 0.000075)?
        || t.sea.get(cell)? < (3.0 * width).max(length(field, 0.025)?)
    {
        return Ok(None);
    }
    let rough = relief(field, &within(field, cell, 2.0 * width))?;
    if rough > length(field, 0.0001)? {
        return Ok(None);
    }
    let river = t.river_near(
        cell,
        MapScale::metres(p["captureDistance"], LengthUnit::Kilometre),
    )?;
    let flow = match river {
        Some(r) => 1.0 + (1.0 + water_at(field, r)?).log10() / 10.0,
        None => 0.0,
    };
    Ok(Some(1.0 - rough / length(field, 0.0001)? + flow))
}
fn falls(t: &Terrain<'_>, cell: usize, p: &Measures) -> io::Result<Option<f64>> {
    let field = t.field;
    let steps = field
        .scale
        .cell_count(MapScale::metres(
            p["captureDistance"],
            LengthUnit::Kilometre,
        ))
        .ceil() as usize;
    if height(field, cell)? < length(field, 0.0000375)?
        || t.sea.get(cell)? < length(field, 0.0125)?
        || reaches_sea(field, cell, steps)?
    {
        return Ok(None);
    }
    Ok(Some(
        (1.0 + water_at(field, cell)?).log10() + step_down(field, cell)? / length(field, 0.000025)?,
    ))
}
fn magic(t: &Terrain<'_>, kind: Kind, cell: usize) -> io::Result<Option<f64>> {
    let field = t.field;
    let read = |name| field.shared.scalar(name).get(cell);
    let score = match kind {
        Kind::FireWellspring => {
            let heat = read(S::HeatSourceDensity)?;
            (if heat >= 300.0 { 2.0 } else { 0.0 })
                + heat / 1000.0
                + read(S::FractureConductance)? / 1000.0
        }
        Kind::AuroraVault => {
            let ice = read(S::IceThickness)?;
            (if ice > 0.0 { 2.0 } else { 0.0 })
                + ice / length(field, 0.00025)?
                + height(field, cell)? / length(field, 0.001)?
                + (1000.0 - read(S::Temperature)?) / 1000.0
        }
        Kind::PressureLocus => {
            let depth = field.water().column.store(Store::Standing).held(cell)?;
            let offshore = t.offshore.get(cell)?;
            if offshore < field.scale.cells(1.0) {
                return Ok(None);
            }
            (if depth >= length(field, 0.000375)? {
                2.0
            } else {
                0.0
            }) + depth / length(field, 0.0015)?
                + (offshore / length(field, 0.075)?).min(1.0)
        }
        Kind::GreenwoodHeart => {
            let cover = read(S::TreeCover)?;
            let moisture = read(S::Moisture)?;
            (if cover >= 0.4 && moisture >= 500.0 {
                2.0
            } else {
                0.0
            }) + cover
                + moisture / 1000.0
                - read(S::Slope)? * 50.0
        }
        Kind::SaltPan => pan(t, cell)?,
        _ => return Ok(None),
    };
    Ok(Some(score))
}
fn pan(t: &Terrain<'_>, cell: usize) -> io::Result<f64> {
    let field = t.field;
    let moisture = field.shared.scalar(S::Moisture).get(cell)?;
    let dry = (1.0 - moisture / 1000.0).max(0.0);
    let lake = field.water().column.lake_memory.get(cell)? > 0.0;
    let basin = lake || field.shared.code(C::LandformCodes).get(cell)? == 4;
    let flat =
        relief(field, &within(field, cell, length(field, 0.0075)?))? <= length(field, 0.0000375)?;
    Ok((if moisture <= 400.0 && basin { 2.0 } else { 0.0 })
        + dry
        + if lake { 0.5 } else { 0.0 }
        + if flat { 0.3 } else { 0.0 })
}
pub fn fit(t: &Terrain<'_>, kind: Kind, cell: usize, p: &Measures) -> io::Result<Measures> {
    let mut p = p.clone();
    let field = t.field;
    let cell_km = MapScale::in_units(field.scale.cells(1.2), LengthUnit::Kilometre);
    match kind {
        Kind::VolcanicMountain | Kind::ResistantMountain => {
            let base = base_height(
                field,
                &within(
                    field,
                    cell,
                    MapScale::metres(p["baseRadius"], LengthUnit::Kilometre),
                ),
            )?;
            p.insert("summit".into(), (base + p["prominence"] + 0.5).floor());
        }
        Kind::DomeRing | Kind::ImpactRing => {
            p.insert("diameter".into(), p["diameter"].max(4.0 * cell_km));
        }
        Kind::Escarpment => {
            p.insert("scarpWidth".into(), p["scarpWidth"].max(cell_km));
            p.insert(
                "throw".into(),
                (p["throw"].min(length(field, 0.000025)?.max(1.5 * height(field, cell)?)) + 0.5)
                    .floor(),
            );
        }
        Kind::Canyon => {
            p.insert("rimWidth".into(), p["rimWidth"].max(cell_km));
            p.insert(
                "depth".into(),
                (p["depth"].min(0.8 * height(field, cell)?) + 0.5).floor(),
            );
        }
        Kind::Falls => {
            p.insert(
                "drop".into(),
                (p["drop"].min(0.5 * height(field, cell)?) + 0.5).floor(),
            );
        }
        _ => {
            p.insert("reach".into(), p["reach"].max(cell_km));
        }
    }
    Ok(p)
}
pub fn shape(t: &Terrain<'_>, kind: Kind, cell: usize, p: &Measures) -> io::Result<Site> {
    let field = t.field;
    let center = field.mesh.position(cell);
    let path = match kind {
        Kind::Escarpment => {
            let width = MapScale::metres(p["scarpWidth"], LengthUnit::Kilometre);
            let length = (6.0 * width).max(length(field, 0.0375)?);
            let (down, _) = t.downhill(cell, 3.0 * width)?;
            let along = [-down[1], down[0]];
            let from = field.mesh.point(
                center[0] - along[0] * length / 2.0,
                center[1] - along[1] * length / 2.0,
            );
            t.land_path(from, along, length)?
        }
        Kind::Canyon => {
            let width = MapScale::metres(p["rimWidth"], LengthUnit::Kilometre);
            let length = (8.0 * width).max(length(field, 0.0375)?);
            let (direction, _) = t.downhill(cell, length / 2.0)?;
            t.land_path(center, direction, length)?
        }
        _ => vec![center],
    };
    Ok(Site { center: cell, path })
}
