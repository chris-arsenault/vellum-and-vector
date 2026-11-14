use super::{
    code,
    components::{across, Component, Frame},
    crust_per_rock, ground, metres,
    shape::{segment_scale, sheet_at},
    sign, Field, PhysicalContext, Settings, C, G,
};
use crate::{scale::MapScale, storage::Band};
// hpc-exempt: named thrust-sheet movement; terrain values remain typed bands.
use std::{collections::BTreeMap, io};
pub(super) fn in_belt(field: &Field, c: &Component, cell: usize) -> io::Result<bool> {
    Ok(ground(field, G::ThrustPairIds, cell)? == f64::from(c.pair) + 1.0)
}
fn shortening(field: &Field, p: &Settings, c: &Component) -> f64 {
    c.strain
        * if field.crust_formed {
            field.last_plate_drift_step
        } else {
            p.orogenic_initial_shortening
        }
}
fn thrust_slip(shortening: f64, sheet: i32, front: i32, most: f64) -> f64 {
    if sheet > front {
        return 0.0;
    }
    let total = (1.0 - 0.62f64.powi(front + 1)) / (1.0 - 0.62);
    most.min(shortening * 0.62f64.powi(front - sheet) / total)
}
pub(super) fn advance(
    field: &mut Field,
    p: &Settings,
    components: &mut [Component],
    frame: &Frame,
) -> io::Result<()> {
    let mut work = vec![0.0f64; components.len()];
    let mut distance = vec![0.0f64; components.len()];
    for cell in 0..field.mesh.len() {
        let id = code(field, C::OrogenicComponentIds, cell)?;
        if id < 0 || !in_belt(field, &components[id as usize], cell)? {
            continue;
        }
        let id = id as usize;
        work[id] = work[id].max(frame.distance.get(cell)?);
        distance[id] = distance[id].max(frame.reach.get(cell)?);
        components[id].front_sheet = components[id]
            .front_sheet
            .max(ground(field, G::ThrustSheetIndex, cell)? as i32 - 1);
    }
    let first: Vec<_> = components.iter().map(|c| c.front_sheet + 1).collect();
    for cell in 0..field.mesh.len() {
        let id = code(field, C::OrogenicComponentIds, cell)?;
        if id < 0 || in_belt(field, &components[id as usize], cell)? {
            continue;
        }
        let id = id as usize;
        let c = &mut components[id];
        let source = frame.source.get(cell)?;
        if source < 0 || c.code != 1 {
            continue;
        }
        if frame.distance.get(cell)?
            > work[id] + shortening(field, p, c) * p.orogenic_accretion_ratio
        {
            continue;
        }
        let (sheet, across, segment) = sheet_at(
            field,
            p,
            c,
            cell,
            source as usize,
            (frame.reach.get(cell)? - distance[id]).max(0.0),
        )?;
        let numbered = first[id] + sheet;
        field
            .ground
            .try_borrow_mut()
            .map_err(io::Error::other)?
            .join_sheet(
                cell,
                [
                    f64::from(c.pair) + 1.0,
                    f64::from(numbered + 1),
                    f64::from(segment),
                ],
                across,
            )?;
        c.front_sheet = c.front_sheet.max(numbered);
    }
    Ok(())
}
struct Moved {
    origin: Band<i32>,
    under: Band<i32>,
    climb: Band<f64>,
    left: Band<u8>,
}
struct Pass<'a> {
    settings: &'a Settings,
    most: f64,
    // hpc-exempt: movement belongs to named thrust sheets, matching retained per-sheet slip.
    moves: BTreeMap<String, f64>,
}
impl Pass<'_> {
    fn distance(
        &mut self,
        field: &mut Field,
        p: &Settings,
        c: &Component,
        segment: f64,
        sheet: i32,
    ) -> f64 {
        let key = format!("{}:{segment}:{sheet}", c.pair);
        if let Some(&held) = self.moves.get(&key) {
            return held;
        }
        let drawn: f64 = (0..sheet)
            .map(|k| thrust_slip(shortening(field, p, c), k, c.front_sheet, self.most))
            .sum();
        let owed =
            field.thrust_slip.get(&key).copied().unwrap_or(0.0) + segment_scale(c, segment) * drawn;
        let moved = (owed / field.mesh.spacing()).floor() * field.mesh.spacing();
        field.thrust_slip.insert(key.clone(), owed - moved);
        self.moves.insert(key, moved);
        moved
    }
}
fn way_out(field: &Field, cell: usize, source: usize) -> io::Result<Option<[f64; 3]>> {
    let tx = super::read(field, super::S::TectonicTangentX, source)? / 1000.0;
    let ty = super::read(field, super::S::TectonicTangentY, source)? / 1000.0;
    let length = tx.hypot(ty);
    let offset = across(field, cell, source)?;
    if length < 0.01 || offset == 0.0 {
        return Ok(None);
    }
    let side = sign(offset);
    Ok(Some([-ty * side / length, tx * side / length, side]))
}
struct SheetLocation {
    cell: usize,
    source: usize,
    out: [f64; 3],
}
fn origin(
    field: &mut Field,
    p: &Settings,
    c: &Component,
    location: &SheetLocation,
    sheet: i32,
    pass: &mut Pass<'_>,
) -> io::Result<Option<usize>> {
    let &SheetLocation { cell, source, out } = location;
    let distance = pass.distance(
        field,
        p,
        c,
        ground(field, G::ThrustSegmentIds, cell)?,
        sheet,
    );
    let at = field.mesh.position(cell);
    let point = field
        .mesh
        .point(at[0] + out[0] * distance, at[1] + out[1] * distance);
    let origin = if distance > 0.0 {
        field.mesh.cell_at(point[0], point[1])
    } else {
        Some(cell)
    };
    let Some(origin) = origin else {
        return Ok(None);
    };
    Ok((in_belt(field, c, origin)?
        && ground(field, G::ThrustSheetIndex, origin)? == f64::from(sheet + 1)
        && (origin == cell || sign(across(field, origin, source)?) == out[2]))
        .then_some(origin))
}
fn leading(
    field: &Field,
    c: &Component,
    cell: usize,
    sheet: i32,
    out: [f64; 3],
) -> io::Result<bool> {
    let at = field.mesh.position(cell);
    let point = field.mesh.point(
        at[0] + out[0] * field.mesh.spacing(),
        at[1] + out[1] * field.mesh.spacing(),
    );
    let Some(ahead) = field.mesh.cell_at(point[0], point[1]) else {
        return Ok(false);
    };
    Ok(in_belt(field, c, ahead)?
        && ground(field, G::ThrustSheetIndex, ahead)? > f64::from(sheet + 1))
}
fn plan_cell(
    field: &mut Field,
    c: &Component,
    frame: &mut Frame,
    moved: &mut Moved,
    pass: &mut Pass<'_>,
    cell: usize,
) -> io::Result<()> {
    let p = pass.settings;
    let source = frame.source.get(cell)? as usize;
    let Some(out) = way_out(field, cell, source)? else {
        return Ok(());
    };
    let location = SheetLocation { cell, source, out };
    let (mut top, mut sheet_on_top, mut under) = (None, -1, None);
    for sheet in 0..=c.front_sheet {
        let Some(from) = origin(field, p, c, &location, sheet, pass)? else {
            continue;
        };
        if top.is_some() {
            under = Some(from);
            break;
        }
        top = Some(from);
        sheet_on_top = sheet;
    }
    let Some(top) = top else {
        if in_belt(field, c, cell)? {
            moved.left.set(cell, 1)?;
        }
        return Ok(());
    };
    if top != cell {
        moved.origin.set(cell, top as i32)?;
    }
    if let Some(under) = under {
        moved.under.set(cell, under as i32)?;
    }
    if !leading(field, c, top, sheet_on_top, out)? {
        return Ok(());
    }
    let metres = thrust_slip(
        shortening(field, p, c),
        sheet_on_top,
        c.front_sheet,
        pass.most,
    );
    moved.climb.set(cell, metres)?;
    frame
        .overlap
        .set(cell, (metres / field.mesh.spacing()).clamp(0.0, 1.0))
}
fn back_limbs(field: &mut Field, frame: &mut Frame, moved: &mut Moved) -> io::Result<()> {
    let mut limb = field.coverage.get_mut().scratch(field.mesh.len(), 0.0f64);
    for cell in 0..field.mesh.len() {
        let climb = moved.climb.get(cell)?;
        let sheet = ground(field, G::ThrustSheetIndex, cell)?;
        if climb <= 0.0 || sheet == 0.0 {
            continue;
        }
        let source = frame.source.get(cell)? as usize;
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if ground(field, G::ThrustSheetIndex, next)? == sheet
                && ground(field, G::ThrustPairIds, next)? == ground(field, G::ThrustPairIds, cell)?
                && code(field, C::OrogenicComponentIds, next)?
                    == code(field, C::OrogenicComponentIds, cell)?
                && sign(across(field, next, source)?) == sign(across(field, cell, source)?)
            {
                limb.set(next, limb.get(next)?.max(climb * 0.6))?;
            }
        }
    }
    for cell in 0..field.mesh.len() {
        if limb.get(cell)? > moved.climb.get(cell)? {
            moved.climb.set(cell, limb.get(cell)?)?;
            frame.overlap.set(
                cell,
                frame
                    .overlap
                    .get(cell)?
                    .max((limb.get(cell)? / field.mesh.spacing()).clamp(0.0, 1.0)),
            )?;
        }
    }
    Ok(())
}
pub(super) fn slip(
    field: &mut Field,
    p: &Settings,
    context: &PhysicalContext,
    components: &[Component],
    frame: &mut Frame,
) -> io::Result<Band<f64>> {
    let n = field.mesh.len();
    let coverage = field.coverage.get_mut();
    let mut moved = Moved {
        origin: coverage.scratch(n, -1),
        under: coverage.scratch(n, -1),
        climb: coverage.scratch(n, 0.0),
        left: coverage.scratch(n, 0),
    };
    let mut pass = Pass {
        settings: p,
        most: p.orogenic_sheet_spacing * context.span,
        // hpc-exempt: one movement per named thrust sheet, not per terrain cell.
        moves: BTreeMap::new(),
    };
    for cell in 0..n {
        let id = code(field, C::OrogenicComponentIds, cell)?;
        if id < 0 {
            continue;
        }
        let c = &components[id as usize];
        if c.code == 1 && c.front_sheet >= 0 {
            plan_cell(field, c, frame, &mut moved, &mut pass, cell)?;
        }
    }
    back_limbs(field, frame, &mut moved)?;
    let mut ground = field.ground.try_borrow_mut().map_err(io::Error::other)?;
    let held = ground.hold(field.coverage.get_mut())?;
    for cell in 0..n {
        if moved.left.get(cell)? != 0 {
            ground.leave_sheet(cell)?;
        }
        let origin = moved.origin.get(cell)?;
        let under = moved.under.get(cell)?;
        if origin < 0 && under < 0 && moved.climb.get(cell)? <= 0.0 {
            continue;
        }
        if under < 0 {
            if origin >= 0 {
                ground.move_sheet(&held, cell, origin as usize)?;
            }
        } else {
            ground.superpose_sheets(
                &held,
                cell,
                under as usize,
                if origin >= 0 { origin as usize } else { cell },
            )?;
        }
    }
    Ok(moved.climb)
}
fn ramp(field: &Field, p: &Settings, cell: usize, climb: f64) -> io::Result<f64> {
    Ok(MapScale::native(
        p.thrust_ramp_gradient
            * climb
            * (0.4 + 0.6 * ground(field, G::CrustContinentalFraction, cell)? / 1000.0),
    ))
}
pub(super) fn climb(
    field: &mut Field,
    p: &Settings,
    belts: usize,
    climb: &Band<f64>,
) -> io::Result<()> {
    let (mut wanted, mut held) = (vec![0.0f64; belts], vec![0.0f64; belts]);
    for cell in 0..field.mesh.len() {
        let id = code(field, C::OrogenicComponentIds, cell)?;
        if id < 0 {
            continue;
        }
        let id = id as usize;
        let area = field.mesh.area(cell) * metres(1.0);
        held[id] += ground(field, G::CrustThickness, cell)?.max(0.0) * area;
        if climb.get(cell)? > 0.0 {
            wanted[id] += ramp(field, p, cell, climb.get(cell)?)?
                * crust_per_rock(ground(field, G::CrustContinentalFraction, cell)? / 1000.0)
                * area;
        }
    }
    let paid: Vec<_> = wanted
        .iter()
        .zip(&held)
        .map(|(&asked, &held)| {
            if asked > 0.0 {
                (held / asked).min(1.0)
            } else {
                0.0
            }
        })
        .collect();
    let mut movement = field.coverage.get_mut().scratch(field.mesh.len(), 0.0);
    for cell in 0..field.mesh.len() {
        let id = code(field, C::OrogenicComponentIds, cell)?;
        if id < 0 || paid[id as usize] <= 0.0 {
            continue;
        }
        let id = id as usize;
        let rise = if climb.get(cell)? > 0.0 {
            ramp(field, p, cell, climb.get(cell)?)? * paid[id]
        } else {
            0.0
        };
        let thickness = ground(field, G::CrustThickness, cell)?;
        field
            .ground
            .try_borrow_mut()
            .map_err(io::Error::other)?
            .adjust_crust(
                cell,
                thickness - thickness.max(0.0) * paid[id] * wanted[id] / held[id],
            )?;
        if rise > 0.0 {
            movement.set(cell, rise)?;
        }
    }
    field
        .ground
        .try_borrow_mut()
        .map_err(io::Error::other)?
        .shift_field(&movement.read_only(), "mountains")
}
