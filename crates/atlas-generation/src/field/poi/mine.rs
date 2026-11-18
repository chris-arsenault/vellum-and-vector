//! Work siting and its effects read real ore, salt, prism and stone deposits.
use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    ground_deposits::{near, stands_on},
    ground_reads::{self as ground, GroundState},
    kinds::{Group, Kind},
    map_records, places, reads, sites,
    state::State,
    values::*,
    visibility,
};
use crate::{
    features::records::Attributes,
    field::{shared::Scalar, significance::measure},
    hpc::BitSet,
    magic::{channels::Channel, inventory::exposure},
    rock::ground::{queries::SurfaceResponse, GroundField},
    scale::MapScale,
};
use std::{io, rc::Rc};
const TAPPABLE_FIRE: f64 = 100.0;
const TYPICAL_DOSE: f64 = 0.5;
const WORKING_SPACING: f64 = 0.015;
const TAPPING_REACH: f64 = 0.00625;
fn tappable(s: &impl State, c: usize) -> io::Result<bool> {
    Ok(reads::magic_rule(s, "fire", "vein", c)?
        || reads::magic_value(s, "fire", Channel::Intensity, c)? >= TAPPABLE_FIRE)
}
fn ore(s: &impl State, c: usize) -> io::Result<f64> {
    let fallen = ground::stock_per_area(s, "fire", "fallen/held", c)? / 1000.0;
    let spent = ground::stock_per_area(s, "fire", "vein/spent", c)? / 1000.0;
    let field = s.field()?;
    let burial = match reads::magic_field(s, "fire") {
        Some(f) => f.definition().parameters.bury_depth,
        None => measure(&field.scale, 0.000005, 1, 0.5)?,
    };
    let bare = exposure(&field.ground(), c, burial, None)?;
    let tap = if tappable(s, c)? {
        reads::magic_value(s, "fire", Channel::Intensity, c)? / 1000.0
    } else {
        0.0
    };
    Ok(tap.max(fallen).max(spent * bare))
}
pub fn deposit(s: &impl GroundState, c: usize) -> io::Result<f64> {
    let salt = (ground::reservoir_per_area(s, "salt", "bed", c)? / ground::full_salt(s))
        .max(if ground::pan(s, c)? { 0.4 } else { 0.0 });
    let rock = reads::rock(s.field()?, c, SurfaceResponse::HardestShare)?;
    let stone = if rock >= 0.5
        && ground::sediment(s, c)? < measure(&s.field()?.scale, 0.00000025, 1, 0.5)?
    {
        0.3 * rock
    } else {
        0.0
    };
    Ok(ore(s, c)?
        .max(if reads::magic_rule(s, "aurora", "prism", c)? {
            1.0
        } else {
            0.0
        })
        .max(salt)
        .max(if ground::placer(s, c)? { 0.4 } else { 0.0 })
        .max(stone)
        .min(1.0))
}
fn peopled(s: &impl State) -> io::Result<Rc<BitSet>> {
    s.held().get("mine:peopled", || {
        let field = s.field()?;
        let mut cells = BitSet::new(field.mesh.len());
        let reach = measure(&field.scale, TAPPING_REACH, 1, 1.0)?;
        for town in reads::settlements(s)?.iter() {
            if let Some(at) = reads::feature_cell(field, town) {
                for cell in sites::within(&field.mesh, at, reach) {
                    cells.add(cell);
                }
            }
        }
        Ok(cells)
    })
}
fn requires(s: &impl GroundState, c: usize) -> io::Result<bool> {
    Ok(ground::land(s, c)? && peopled(s)?.has(c) && deposit(s, c)? > 0.0)
}
fn suitability(s: &impl GroundState, c: usize) -> io::Result<f64> {
    Ok(
        (deposit(s, c)? * (1.0 - (cover_shared::scalar(s, Scalar::Slope, c)? / 0.3).min(1.0)))
            .sqrt(),
    )
}
fn found(s: &impl GroundState) -> io::Result<Vec<Place>> {
    Ok(places::sited_places(
        s,
        Kind::Mine,
        |c| requires(s, c),
        |c| suitability(s, c),
        measure(&s.field()?.scale, WORKING_SPACING, 1, 1.0)?,
    )?
    .as_ref()
    .clone())
}
fn is_a(s: &impl GroundState, c: usize) -> io::Result<bool> {
    places::holds_record(s, Kind::Mine, c, || found(s))
}
fn work<'a>(s: &impl State, p: &'a Place) -> io::Result<&'a str> {
    if let Some(work) = p
        .feature
        .as_ref()
        .and_then(|f| f.attributes.get("work"))
        .and_then(|v| v.as_str())
    {
        return Ok(work);
    }
    Ok(if tappable(s, p.anchor)? {
        "tapping"
    } else {
        "quarrying"
    })
}
fn dose(p: &Place) -> f64 {
    p.feature
        .as_ref()
        .and_then(|f| f.attributes.get("dose"))
        .and_then(|v| v.as_f64())
        .unwrap_or(TYPICAL_DOSE)
}
fn magnitude(_: &impl State, p: &Place) -> io::Result<f64> {
    Ok(visibility::sized(dose(p), TYPICAL_DOSE))
}
fn local(s: &impl GroundState, p: &Place) -> io::Result<f64> {
    visibility::stands_out(s, p, ground::around(s)?, |c| deposit(s, c))
}
fn isolation(s: &impl GroundState, p: &Place) -> io::Result<f64> {
    visibility::alone_among(s, p, &found(s)?, 2.0 * ground::around(s)?)
}
fn cultural(s: &impl State, p: &Place) -> io::Result<f64> {
    visibility::attachment(s, p, 2.0 * ground::around(s)?)
}
fn work_on_rock(s: &impl State, p: &Place) -> io::Result<Vec<FieldChange>> {
    if !ground::land(s, p.anchor)? {
        return Ok(Vec::new());
    }
    if work(s, p)? == "tapping" {
        return Ok(vec![FieldChange::Physical(PhysicalChange {
            cell: p.anchor,
            band: PhysicalBand::Scalar(Scalar::FractureConductance),
            change: Change::Add(250.0 * dose(p)),
        })]);
    }
    if !reads::magic_rule(s, "aurora", "prism", p.anchor)? {
        return Ok(Vec::new());
    }
    let held =
        reads::magic_field(s, "aurora").map_or(0.0, |f| f.definition().effects.ice_persistence);
    Ok(vec![FieldChange::Physical(PhysicalChange {
        cell: p.anchor,
        band: PhysicalBand::Scalar(Scalar::IcePersistence),
        change: Change::AtMost(held * (1.0 - dose(p).min(1.0))),
    })])
}
fn fields<S: State + 'static>() -> Fields<S> {
    Fields { statement: Must::Value("Work lowers a pit, strips canopy and fouls the downstream land. Tapping opens fractures; quarrying frees a prism's held ice.".into()),
        terrain: Slot::Value(Rc::new(|s, p| {
            if !ground::land(s, p.anchor)? { return Ok(Vec::new()); }
            Ok(vec![FieldChange::Physical(PhysicalChange { cell: p.anchor, band: PhysicalBand::Ground(GroundField::Elevation), change: Change::Add(-MapScale::native(measure(&s.field()?.scale, 0.0000025, 1, 0.5)? * dose(p))) })])
        })),
        water: Slot::Value(Rc::new(|s, p| {
            let below = s.field()?.water().routing.targets.get(p.anchor)?;
            if below < 0 || !ground::land(s, below as usize)? { return Ok(Vec::new()); }
            Ok(vec![FieldChange::Physical(PhysicalChange { cell: below as usize, band: PhysicalBand::Scalar(Scalar::EcologicalToxicity), change: Change::AtLeast((0.5 * dose(p)).min(1.0)) })])
        })),
        climate: Slot::NotApplicable("The pit lies below the climate field's scale."),
        cover: Slot::Value(Rc::new(|s, p| {
            if !ground::land(s, p.anchor)? { return Ok(Vec::new()); }
            Ok([Scalar::TreeCover, Scalar::BroadleafCover, Scalar::ConiferCover].into_iter().map(|band| FieldChange::Physical(PhysicalChange { cell: p.anchor, band: PhysicalBand::Scalar(band), change: Change::AtMost(0.0) })).collect())
        })), magic: Slot::Value(Rc::new(work_on_rock)),
    }
}
fn counterpart<S: GroundState + CatalogueState<Schedule>, Schedule>(
    s: &S,
    c: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(s, c, s.parent_cell_span(), 1.0, |cell| {
        Ok(deposit(s, cell)? > 0.0)
    })
}
fn moved<S: GroundState + CatalogueState<Schedule>, Schedule>(
    s: &S,
    c: &Carried,
) -> io::Result<Unrealized> {
    Ok(counterpart(s, c)?.map_or(Unrealized::Drop, Unrealized::Move))
}
fn across<S: GroundState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
) -> AcrossMaps<S, Schedule> {
    AcrossMaps { statement: Must::Value("A captured working keeps a bench and follows a deposit within one parent span; a flooded working moves or goes by the same rule.".into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::Value(Rc::new(|_, c| Ok(vec![FieldChange::GradeGround { cell: c.cell, gradient: 0.12 }]))), counterpart: Slot::Value(Rc::new(counterpart)), unrealized: Slot::Value(Rc::new(moved)), settle: Slot::Value(Rc::new(|s, c| {
        if matches!(s.field()?.water().column.kind.get(c.cell)?, 1 | 2) { moved(s, c) } else { Ok(Unrealized::Keep) }
    })), schedule: Slot::NotApplicable("The mine adds no refinement step.") }
}
fn anchor_cost<S: State + 'static>(which: &'static str, factor: f64) -> OnPlace<S, Vec<Cost>> {
    Rc::new(move |s, p| {
        Ok(if work(s, p)? == which {
            vec![Cost {
                cell: p.anchor,
                factor,
            }]
        } else {
            Vec::new()
        })
    })
}
fn movement<S: State + 'static>() -> Movement<S> {
    Movement { on_foot: Some(TrailRole::Destination), statement: Must::Value("Haul roads wear the nearby ground; taps ease crust passage and quarries send charge with people.".into()), roads: Slot::Value(Rc::new(|s, p| carry_rules::cost_near(s, p, 0.7, measure(&s.field()?.scale, 0.00125, 1, 1.0)?))), boats: Slot::NotApplicable("Shipping uses the harbour or river town."), drainage: Slot::NotApplicable("The network reads the lowered ground directly."), magic: Slot::Value([(Carrier::Crust, anchor_cost("tapping", 0.7)), (Carrier::People, anchor_cost("quarrying", 0.85))].into_iter().collect()), links: Slot::NotApplicable("A working joins no walking cells."), crosses: Slot::NotApplicable("The pit is no through route.") }
}
fn others<S: State + 'static>() -> Others<S> {
    Others { statement: Must::Value("A working needs nearby people and a deposit; its output goes to a forge and towns can grow at its gate.".into()), needs: Slot::Value(vec![Relation { kind: Kind::Settlement, holds: Rc::new(|s: &S, a, b| places::within(s, a, b, measure(&s.field()?.scale, TAPPING_REACH, 1, 1.0)?)) }]), excludes: Slot::Value(vec![stands_on(Kind::Lake)]), contains: Slot::NotApplicable("A mine is one point of work."), pairs_with: Slot::Value(vec![stands_on(Kind::ThermalVein), near(Kind::FrostPrism, 1.0), stands_on(Kind::Placer), stands_on(Kind::SaltPan), near(Kind::Forge, 4.0)]) }
}
fn offers(s: &impl GroundState, p: &Place) -> io::Result<Benefits> {
    let great = magnitude(s, p)?;
    let rich = deposit(s, p.anchor)?;
    let mut benefits: Benefits = [
        (Benefit::Materials, (great + rich) / 2.0),
        (Benefit::Trade, great / 2.0),
    ]
    .into_iter()
    .collect();
    if work(s, p)? == "tapping" {
        benefits.insert(Benefit::Power, rich / 2.0);
    }
    Ok(benefits)
}
fn visible<S: GroundState + 'static>() -> Visibility<S> {
    Visibility { statement: Must::Value("Work dose, richer ground and isolation establish the mark; a dependent settlement can carry it.".into()), magnitude: Slot::Value(Rc::new(magnitude)), local_conditions: Slot::Value(Rc::new(local)), isolation: Slot::Value(Rc::new(isolation)), cultural: Slot::Value(Rc::new(cultural)), importance: Must::Value(Rc::new(|s, p| Ok((0.55 * magnitude(s, p)? + 0.2 * local(s, p)? + 0.25 * isolation(s, p)?).max(cultural(s, p)?)))) }
}
pub fn entry<S: GroundState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
) -> Entry<S, Schedule> {
    Entry { id: Kind::Mine, group: Group::Ground, name: "Mine".into(), recognition: Recognition { distinct: Must::Value("A working cut into a deposit, including quarrying and tapping; ore, stone, salt and prism are properties of its underlying deposit.".into()), is_a: Must::Value(Rc::new(is_a)), landform: Slot::Unwritten },
        existence: Existence { statement: Must::Value("People site the best deposits within their reach, separating workings by their district spacing.".into()), origins: Slot::Unwritten, way: Must::Value(ExistenceWay::Sited), requires: Slot::Value(Rc::new(requires)), suitability: Slot::Value(Rc::new(suitability)), places: Must::Value(Rc::new(found)) },
        publication: Publication { delivery: Delivery::Landforms, statement: Must::Value("Publish a working site with its work and maintained dose.".into()), moment: Must::Value(Moment::Society), record: Must::Value(Rc::new(|s: &S, p: &Place| {
            let mut attributes = Attributes::new(); attributes.insert("work".into(), work(s, p)?.into()); attributes.insert("dose".into(), dose(p).into()); map_records::site(s, p, "mine", "landUse", "Mine", attributes)
        })) }, across_maps: across(), event: None,
        roles: Roles { true_size: super::true_sizes::sited(&super::true_sizes::MINE), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(Kind::Mine), fields: fields(), movement: movement(), others: others(),
            people: People { statement: Must::Value("Maintained work supplies materials and trade; taps also supply power and risk a fracture burst, while quarries risk collapse.".into()), offers: Slot::Value(Rc::new(offers)), threatens: Slot::Value(Rc::new(|s, p| Ok(vec![Hazard { hazard: if work(s, p)? == "tapping" { "burst along the opened fracture" } else { "collapse" }.into(), reach: measure(&s.field()?.scale, 0.00025, 1, 1.0)?, severity: magnitude(s, p)? }]))) },
            time: ThroughTime { statement: Must::Value("Abandonment or depletion ends a working and leaves its ruin.".into()), fate: Slot::Value(Rc::new(|s, p| Ok(if deposit(s, p.anchor)? > 0.0 && dose(p) > 0.1 { Fate::Persists } else { Fate::Ends { leaves: Some(Kind::Ruin) } }))) }, visibility: visible(),
            naming: Naming { statement: Must::Value("Workers use the vein or pan's name, which can pass to the town at the gate.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::Value(vec![NameRelation { relation: stands_on(Kind::ThermalVein), chance: None }, NameRelation { relation: stands_on(Kind::SaltPan), chance: None }]), lends_name_to: Slot::Value(vec![near(Kind::Settlement, 1.0)]), term: Slot::Unwritten },
        },
    }
}
