//! Named endpoints survive independently of the current crossing that Veil permits.
use super::{
    anomaly_reads as anomaly, carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    map_records::MapState,
    places, reads, records,
    state::State,
    values::*,
    visibility,
};
use crate::{
    features::Feature,
    field::{refinement::topology::distance, shared::Scalar, significance::measure},
    hpc::BitSet,
    magic::{
        channels::Channel,
        state::{Door, MagicField},
        veil::doors::Conditions,
    },
    rock::ground::GroundField,
    scale::MapScale,
};
use atlas_map::{Geometry, Position};
use std::{io, rc::Rc};

fn pairs(s: &impl State) -> Option<std::cell::Ref<'_, [Door]>> {
    reads::magic_field(s, "veil").map(|field| std::cell::Ref::map(field, MagicField::doors))
}
fn found(s: &impl State) -> io::Result<Vec<Place>> {
    Ok(s.held()
        .get("places:door", || {
            Ok(pairs(s)
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .map(|pair| {
                    let mut place = Place::at(
                        Kind::Door,
                        pair.a,
                        if pair.a == pair.b {
                            vec![pair.a]
                        } else {
                            vec![pair.a, pair.b]
                        },
                    );
                    place.id = format!("door:{}:{}", pair.a, pair.b);
                    place
                })
                .collect::<Vec<_>>())
        })?
        .as_ref()
        .clone())
}
fn is_a(s: &impl State, c: usize) -> io::Result<bool> {
    Ok(s.held()
        .get("cells:door", || {
            let mut cells = BitSet::new(s.field()?.mesh.len());
            for pair in pairs(s).as_deref().unwrap_or(&[]) {
                cells.add(pair.a);
                cells.add(pair.b);
            }
            Ok(cells)
        })?
        .has(c))
}
fn holds_open(s: &impl State, c: usize) -> io::Result<bool> {
    let Some(veil) = reads::magic_field(s, "veil") else {
        return Ok(false);
    };
    let Some(origin) = veil
        .definition()
        .origins
        .iter()
        .position(|o| o.id == "tear")
    else {
        return Ok(false);
    };
    Conditions::for_field(s.magic().as_deref().unwrap_or(&[]), &veil).holds_with_ward(
        &veil,
        &veil.origin_source(origin),
        c,
        veil.definition().parameters.door_strain,
        cover_shared::scalar(s, Scalar::Warding, c)?,
    )
}
pub fn traversable_pair(
    pairs: &[Door],
    cells: &[usize],
    eligible: impl Fn(usize) -> io::Result<bool>,
) -> io::Result<bool> {
    if cells.len() != 2 || cells[0] == cells[1] {
        return Ok(false);
    }
    let (a, b) = (cells[0], cells[1]);
    Ok(eligible(a)?
        && eligible(b)?
        && pairs
            .iter()
            .any(|p| (p.a == a && p.b == b) || (p.a == b && p.b == a)))
}
fn traversable(s: &impl State, p: &Place) -> io::Result<bool> {
    traversable_pair(pairs(s).as_deref().unwrap_or(&[]), &p.cells, |c| {
        holds_open(s, c)
    })
}
fn breaks(s: &impl State, c: usize) -> io::Result<bool> {
    let Some(veil) = reads::magic_field(s, "veil") else {
        return Ok(false);
    };
    Ok(
        Conditions::for_field(s.magic().as_deref().unwrap_or(&[]), &veil).ruptured(c)?
            || veil.channel(Channel::Wild).get(c)? >= 0.1,
    )
}
fn around(s: &impl State) -> io::Result<f64> {
    anomaly::country(s, 0.00125)
}
fn door_distance(s: &impl State) -> io::Result<f64> {
    match reads::magic_field(s, "veil") {
        Some(f) => Ok(f.definition().parameters.door_distance),
        None => measure(&s.field()?.scale, 0.00000025, 1, 1.0),
    }
}
fn magnitude(s: &impl State, p: &Place) -> io::Result<f64> {
    let span = if p.cells.len() > 1 {
        distance(&s.field()?.mesh, p.cells[0], p.cells[1])
    } else {
        0.0
    };
    Ok(span / (span + door_distance(s)?))
}
fn at_either(
    s: &impl State,
    p: &Place,
    read: impl Fn(&Place) -> io::Result<f64>,
) -> io::Result<f64> {
    let _ = s;
    let mut value = f64::NEG_INFINITY;
    for &cell in &p.cells {
        let mut end = p.clone();
        end.anchor = cell;
        value = value.max(read(&end)?);
    }
    Ok(value)
}
fn local(s: &impl State, p: &Place) -> io::Result<f64> {
    at_either(s, p, |end| {
        visibility::stands_out(s, end, around(s)?, |c| {
            cover_shared::scalar(s, Scalar::Tearing, c)
        })
    })
}
fn isolation(s: &impl State, p: &Place) -> io::Result<f64> {
    visibility::alone_among(s, p, &found(s)?, door_distance(s)?)
}
fn cultural(s: &impl State, p: &Place) -> io::Result<f64> {
    at_either(s, p, |end| visibility::attachment(s, end, around(s)?))
}
fn record(s: &impl MapState, p: &Place) -> io::Result<Option<Feature>> {
    let Some(mut record) = records::rule(s, p, "veil", "door")? else {
        return Ok(None);
    };
    let mesh = &s.field()?.mesh;
    let [ox, oy] = mesh.origin();
    let [x, y] = mesh.position(p.anchor);
    let at = Position::xy(x + ox, y + oy);
    record.geometry = Geometry::Point { coordinates: at };
    record.attributes.insert(
        "representative".into(),
        serde_json::json!({"x": x + ox, "y": y + oy}),
    );
    record.attributes.insert(
        "ends".into(),
        serde_json::json!(p
            .cells
            .iter()
            .map(|&cell| {
                let [x, y] = mesh.position(cell);
                [x + ox, y + oy]
            })
            .collect::<Vec<_>>()),
    );
    Ok(Some(record))
}
/// Captured references remain authoritative; newly developed geography is not captured again.
pub fn captured_pair(
    feature: &Feature,
    system: &str,
    cell_of: impl Fn(f64, f64) -> Option<usize>,
) -> Option<(usize, usize)> {
    if feature
        .attributes
        .get("developedBy")
        .and_then(|v| v.as_str())
        == Some("regional")
    {
        return None;
    }
    let attributes = feature
        .attributes
        .get("capturedRecord")
        .and_then(|v| v.get("attributes"))
        .and_then(|v| v.as_object())
        .unwrap_or(&feature.attributes);
    if attributes.get("system").and_then(|v| v.as_str()) != Some(system)
        || attributes.get("rule").and_then(|v| v.as_str()) != Some("door")
    {
        return None;
    }
    let ends = attributes.get("ends")?.as_array()?;
    let end = |at: usize| {
        let point = ends.get(at)?.as_array()?;
        cell_of(point.first()?.as_f64()?, point.get(1)?.as_f64()?)
    };
    let a = end(0);
    let b = if ends.len() > 1 { end(1) } else { a };
    Some((a.or(b)?, b.or(a)?))
}
fn frame_cell(s: &impl State, x: f64, y: f64) -> Option<usize> {
    let field = s.physical()?;
    let mesh = &field.mesh;
    let [ox, oy] = mesh.origin();
    mesh.cell_at(x - ox, y - oy)
}
fn carry(s: &impl State, feature: &Feature) -> io::Result<Option<Carried>> {
    Ok(
        captured_pair(feature, "veil", |x, y| frame_cell(s, x, y)).map(|(a, b)| Carried {
            feature: feature.clone(),
            cell: a,
            cells: if a == b { vec![a] } else { vec![a, b] },
        }),
    )
}
pub fn seed_captured_doors(
    field: &mut MagicField,
    features: &[Feature],
    cell_of: impl Fn(f64, f64) -> Option<usize>,
) {
    for feature in features {
        if let Some((a, b)) = captured_pair(feature, &field.definition().id, &cell_of) {
            field.seed_door(a, b);
        }
    }
}
fn fields<S: State + 'static>() -> Fields<S> {
    Fields { statement: Must::Value("Each active end sinks a pool, chills its cell and grows a ring of grass and saplings on adjacent land.".into()),
        terrain: Slot::Value(Rc::new(|s, p| { let depth = reads::magic_field(s, "veil").map_or(0.0, |f| f.definition().parameters.door_pool); Ok(p.cells.iter().map(|&cell| FieldChange::Physical(PhysicalChange { cell, band: PhysicalBand::Ground(GroundField::Elevation), change: Change::Add(-MapScale::native(depth)) })).collect()) })),
        water: Slot::Value(Rc::new(|s, p| { let elevation = s.field()?.ground().view(GroundField::Elevation); p.cells.iter().map(|&cell| Ok(FieldChange::Physical(PhysicalChange { cell, band: PhysicalBand::WaterSurfaceElevations, change: Change::AtLeast(elevation.get(cell)?) }))).collect() })),
        climate: Slot::Value(Rc::new(|s, p| { let chill = reads::magic_field(s, "veil").map_or(0.0, |f| f.definition().parameters.door_chill); Ok(p.cells.iter().map(|&cell| FieldChange::Physical(PhysicalChange { cell, band: PhysicalBand::Scalar(Scalar::Temperature), change: Change::Add(-chill) })).collect()) })),
        cover: Slot::Value(Rc::new(|s, p| {
            let field = s.field()?; let mut changes = Vec::new();
            for &cell in &p.cells { for edge in 0..3 { if let Some(next) = field.mesh.neighbor(cell, edge) { if field.water().column.kind.get(next)? == 0 {
                for (band, value) in [(Scalar::GrassCover, 0.3), (Scalar::BroadleafSaplings, 0.05)] { changes.push(FieldChange::Physical(PhysicalChange { cell: next, band: PhysicalBand::Scalar(band), change: Change::AtLeast(value) })); }
            } } } } Ok(changes)
        })), magic: Slot::NotApplicable("Veil's feedback writes Tearing whether there is a door or not."),
    }
}
fn near<S: State + 'static>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|s, a, b| places::within(s, a, b, around(s)?)),
    }
}
fn inside<S: State + 'static>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))),
    }
}
fn movement<S: State + 'static>() -> Movement<S> {
    Movement { on_foot: None, statement: Must::Value("Only a current eligible pair joins walkers across distant ground; no water or physical carrier passes the crossing.".into()), roads: Slot::NotApplicable("The crossing is expressed by its links."), boats: Slot::NotApplicable("The crossing is walked."), drainage: Slot::Value(Rc::new(|s, p| carry_rules::cost_near(s, p, 0.8, 0.0))), magic: Slot::NotApplicable("Physical carriers stop at the ends and stored Pressure cannot pass."), links: Slot::Value(Rc::new(|s, p| Ok(if traversable(s, p)? { vec![Link { a: p.cells[0], b: p.cells[1] }] } else { Vec::new() }))), crosses: Slot::Value(Rc::new(|s, p| Ok(if traversable(s, p)? { vec![Barrier::River, Barrier::Ridge, Barrier::Strait, Barrier::Wetland, Barrier::Ice, Barrier::Ward] } else { Vec::new() }))) }
}
fn fate(s: &impl State, p: &Place) -> io::Result<Fate> {
    let mut all_open = true;
    for &cell in &p.cells {
        if !holds_open(s, cell)? {
            all_open = false;
            break;
        }
    }
    if all_open {
        return Ok(Fate::Persists);
    }
    for &cell in &p.cells {
        if breaks(s, cell)? {
            return Ok(Fate::Ends {
                leaves: Some(Kind::WildZone),
            });
        }
    }
    Ok(Fate::Ends { leaves: None })
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    Entry { id: Kind::Door, group: Group::Anomalies, name: "Door".into(), recognition: Recognition { distinct: Must::Value("A paired crossing in Veil's current doors, with two separate endpoints retained under one place identity.".into()), is_a: Must::Value(Rc::new(is_a)), landform: Slot::Unwritten },
        existence: Existence { statement: Must::Value("Veil pairs stable strong tears by nearest strength at a distance; a pair persists while both ends qualify.".into()), origins: Slot::Unwritten, way: Must::Value(ExistenceWay::Emerges), requires: Slot::Value(Rc::new(holds_open)), suitability: Slot::Value(Rc::new(|s, c| Ok(if holds_open(s, c)? { anomaly::origin_source(s, "veil", "tear", c)? / 1000.0 } else { 0.0 }))), places: Must::Value(Rc::new(found)) },
        publication: Publication { delivery: Delivery::Landforms, statement: Must::Value("Publish one point record at the first end, retaining both endpoint positions for refinement.".into()), moment: Must::Value(Moment::Magic), record: Must::Value(Rc::new(record)) },
        across_maps: AcrossMaps { statement: Must::Value("Captured endpoints retain the name. Current fields determine traversal; an outside partner supplies no crossing on this frame.".into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry)), realize: Slot::NotApplicable("Captured candidates seed shared pairing once; current eligibility governs active doors and their effects."), counterpart: Slot::Value(Rc::new(|s, c| carry_rules::counterpart(s, c, s.parent_cell_span(), 1.0, |cell| is_a(s, cell)))), unrealized: Slot::Value(Rc::new(|_, _| Ok(Unrealized::Keep))), settle: Slot::NotApplicable("Water does not move captured endpoints."), schedule: Slot::NotApplicable("Shared field refresh checks current pairing candidates.") }, event: None,
        roles: Roles { true_size: super::true_sizes::extent(), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(Kind::Door), fields: fields(), movement: movement(),
            others: Others { statement: Must::Value("A door stands in a tear, outside conditions which close it; settlements, ruins and shrines gather at its house.".into()), needs: Slot::Value(vec![inside(Kind::Tear)]), excludes: Slot::Value([Kind::AuroraField, Kind::LightWell, Kind::ThermalVein, Kind::FireCore, Kind::WardRing, Kind::WardLine].into_iter().map(inside).collect()), contains: Slot::NotApplicable("Each end holds the crossing itself."), pairs_with: Slot::Value([Kind::Settlement, Kind::Ruin, Kind::Shrine, Kind::WildZone].into_iter().map(near).collect()) },
            people: People { statement: Must::Value("Distance saved brings trade and defence; the keepers' house has sanctity, while travellers risk sickness and rupture.".into()), offers: Slot::Value(Rc::new(|s, p| { let reach = magnitude(s, p)?; Ok([(Benefit::Trade, reach), (Benefit::Sanctity, 0.4), (Benefit::Defence, reach / 2.0)].into_iter().collect()) })), threatens: Slot::Value(Rc::new(|s, p| Ok(vec![Hazard { hazard: "crossing sickness".into(), reach: measure(&s.field()?.scale, 0.00025, 1, 1.0)?, severity: magnitude(s, p)? / 2.0 }, Hazard { hazard: "rupture into wild ground".into(), reach: around(s)?, severity: 0.8 }]))) },
            time: ThroughTime { statement: Must::Value("Either end can close the pair. Fire release or moving strain leaves wild ground; charge and wards close it quietly.".into()), fate: Slot::Value(Rc::new(fate)) },
            visibility: Visibility { statement: Must::Value("Distance saved and rarity establish the mark; the town and local contrast at either end can carry it.".into()), magnitude: Slot::Value(Rc::new(magnitude)), local_conditions: Slot::Value(Rc::new(local)), isolation: Slot::Value(Rc::new(isolation)), cultural: Slot::Value(Rc::new(cultural)), importance: Must::Value(Rc::new(|s, p| Ok((0.5 * magnitude(s, p)? + 0.1 * local(s, p)? + 0.4 * isolation(s, p)?).max(cultural(s, p)?)))) },
            naming: Naming { statement: Must::Value("Keepers use the end towns' names, or towns inherit the door's name.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::Value(vec![NameRelation { relation: near(Kind::Settlement), chance: None }]), lends_name_to: Slot::Value(vec![near(Kind::Settlement)]), term: Slot::Unwritten },
        },
    }
}
