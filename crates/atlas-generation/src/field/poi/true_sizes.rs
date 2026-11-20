//! True sizes and map-key accounts for catalogue places.
//!
//! A place drawn as a point stands for one real thing whose size is roughly real with a very
//! long tail: a measured reference (least, typical, largest) rolled from the place's identity,
//! or the place's own facts where it has them (a crossing's river, a settlement's people). A
//! place drawn from its cells covers the extent those cells cover on its map. Map symbols
//! claim no size; these values do.
use super::{
    contract::{OnPlace, TrueSize},
    kinds::Kind,
    reads, settlement_reads,
    state::State,
    values::{Place, Size, Slot},
};
use crate::scale::{LengthUnit, MapScale};
use std::{io, rc::Rc};

/// A measured size with a long tail, in metres.
#[derive(Clone, Copy, Debug)]
pub struct Ladder {
    pub least: f64,
    pub typical: f64,
    pub largest: f64,
}
/// The size of a point place: its breadth across, how much longer than wide it typically
/// runs, and its height where height is part of what it is.
#[derive(Clone, Copy, Debug)]
pub struct Footprint {
    pub across: Ladder,
    pub elongation: f64,
    pub height: Option<Ladder>,
}
const fn ladder(least: f64, typical: f64, largest: f64) -> Ladder {
    Ladder {
        least,
        typical,
        largest,
    }
}
const fn flat(least: f64, typical: f64, largest: f64, elongation: f64) -> Footprint {
    Footprint {
        across: ladder(least, typical, largest),
        elongation,
        height: None,
    }
}
const fn built(across: Ladder, elongation: f64, height: Ladder) -> Footprint {
    Footprint {
        across,
        elongation,
        height: Some(height),
    }
}

// Reference sizes of the real things, in metres. Breadth across is the short side; a long
// place runs up to its elongation times that.
/// A summit's top, from a horn's few metres to a broad dome's crown.
pub const SUMMIT: Ladder = ladder(5.0, 30.0, 400.0);
/// A saddle between heights, longer along the crossing than across it.
pub const PASS: Footprint = flat(20.0, 150.0, 2_000.0, 3.0);
pub const HEADLAND: Footprint = flat(50.0, 500.0, 10_000.0, 2.5);
/// A strait's width at its narrows; it runs several times as long.
pub const STRAIT: Footprint = flat(100.0, 2_000.0, 50_000.0, 5.0);
/// A brook's mouth to a great estuary.
pub const RIVER_MOUTH: Footprint = flat(5.0, 100.0, 20_000.0, 2.0);
/// Surface workings: a shaft head and spoil to a great open pit.
pub const MINE: Footprint = flat(10.0, 80.0, 3_000.0, 1.5);
/// A cleared field from an assart of a few acres to a great clearing.
pub const CLEARANCE: Footprint = flat(30.0, 200.0, 2_000.0, 1.3);
/// The pool or seep a spring rises in.
pub const SPRING: Footprint = flat(0.5, 3.0, 100.0, 1.5);
/// A gravel bar holding heavy grains, long along its river.
pub const PLACER: Footprint = flat(10.0, 80.0, 2_000.0, 4.0);
/// Quays and basin, from a landing to a great port.
pub const HARBOUR: Footprint = flat(30.0, 200.0, 3_000.0, 2.0);
/// A dam's base thickness; its crest runs several times longer.
pub const DAM: Footprint = built(ladder(3.0, 20.0, 300.0), 4.0, ladder(1.0, 5.0, 60.0));
/// A weir, tank or headworks with its channel.
pub const IRRIGATION: Footprint = flat(5.0, 40.0, 1_000.0, 3.0);
pub const MILL: Footprint = built(ladder(6.0, 12.0, 40.0), 1.5, ladder(4.0, 8.0, 20.0));
pub const FORGE: Footprint = built(ladder(5.0, 12.0, 60.0), 1.5, ladder(3.0, 6.0, 15.0));
pub const ARCHIVE: Footprint = built(ladder(8.0, 20.0, 120.0), 1.5, ladder(4.0, 10.0, 30.0));
/// A wayside shrine to a temple and its court.
pub const SHRINE: Footprint = built(ladder(1.0, 6.0, 120.0), 1.3, ladder(1.5, 4.0, 40.0));
pub const BATTLEFIELD: Footprint = flat(300.0, 1_500.0, 8_000.0, 2.0);
pub const DISASTER: Footprint = flat(50.0, 800.0, 20_000.0, 1.5);
/// A ruin whose people are not recorded.
pub const RUIN: Footprint = flat(10.0, 150.0, 3_000.0, 1.3);
/// How broad a ford's wading line is and a bridge's deck.
pub const FORD_BREADTH: Ladder = ladder(3.0, 8.0, 40.0);
pub const BRIDGE_DECK: Ladder = ladder(2.5, 4.5, 12.0);
/// A crossing over a stream too small to resolve still spans this much.
pub const LEAST_CROSSING: f64 = 2.0;
/// Each bank's abutment, as a share of the span, and never less than the least crossing.
pub const ABUTMENT_SHARE: f64 = 0.1;
/// People per hectare: a hamlet of crofts at `SPARSE` by `SPARSE_PEOPLE`, rising by the fourth
/// root of its people towards walled towns; never thinner or denser than the bounds.
pub const SPARSE: f64 = 30.0;
pub const SPARSE_PEOPLE: f64 = 200.0;
pub const THINNEST: f64 = 20.0;
pub const DENSEST: f64 = 200.0;
pub const LEAST_SETTLED: f64 = 10_000.0;
pub const SETTLEMENT_ELONGATION: f64 = 1.3;

/// Shares of all places at each step of the ladder; the last tenth carries the long tail.
const SHARES: [(f64, f64); 5] = [(0.0, 0.0), (0.5, 0.0), (0.9, 0.3), (0.99, 0.65), (1.0, 1.0)];

fn metres(value: f64) -> f64 {
    MapScale::metres(value, LengthUnit::Metre)
}
/// A size from its ladder: half of all places lie between least and typical, and the last
/// hundredth reaches the largest.
pub fn long_tail(roll: f64, ladder: &Ladder) -> f64 {
    let roll = roll.clamp(0.0, 1.0);
    let at = |share: f64, step: f64| {
        if share <= 0.0 {
            ladder.least
        } else if step <= 0.0 {
            ladder.typical
        } else {
            ladder.typical * (ladder.largest / ladder.typical).powf(step)
        }
    };
    for pair in SHARES.windows(2) {
        let ((from, from_step), (to, to_step)) = (pair[0], pair[1]);
        if roll <= to {
            let (low, high) = (at(from, from_step), at(to, to_step));
            let t = (roll - from) / (to - from);
            return metres(low * (high / low).powf(t));
        }
    }
    metres(ladder.largest)
}
/// A footprint's size from three independent rolls: breadth, elongation and height. The
/// median place runs its footprint's elongation; the roundest is as long as wide and the
/// longest runs the elongation squared.
pub fn sited_size(footprint: &Footprint, rolls: [f64; 3]) -> Size {
    let across = long_tail(rolls[0], &footprint.across);
    let length = across
        * footprint
            .elongation
            .max(1.0)
            .powf(2.0 * rolls[1].clamp(0.0, 1.0));
    Size {
        height: footprint.height.map(|height| long_tail(rolls[2], &height)),
        width: Some(across),
        length: Some(length),
    }
}
/// The extent cells cover: length along their principal axis (one cell span more than the
/// farthest centres), and the area spread over that length as width.
pub fn spread(offsets: &[[f64; 2]], area: f64, span: f64) -> Size {
    let n = offsets.len().max(1) as f64;
    let (mx, my) = offsets
        .iter()
        .fold((0.0, 0.0), |(x, y), [ox, oy]| (x + ox / n, y + oy / n));
    let (mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0);
    for [x, y] in offsets {
        let (dx, dy) = (x - mx, y - my);
        xx += dx * dx;
        xy += dx * dy;
        yy += dy * dy;
    }
    let angle = 0.5 * (2.0 * xy).atan2(xx - yy);
    let (ux, uy) = (angle.cos(), angle.sin());
    let (low, high) = offsets
        .iter()
        .fold((0.0f64, 0.0f64), |(low, high), [x, y]| {
            let along = (x - mx) * ux + (y - my) * uy;
            (low.min(along), high.max(along))
        });
    let length = metres(high - low + span);
    Size {
        height: None,
        width: Some((area / length).min(length)),
        length: Some(length),
    }
}
/// A settlement's built ground from its people: denser as it grows, as walled towns were.
pub fn settled_size(people: f64) -> Size {
    let density = (SPARSE * (people.max(0.0) / SPARSE_PEOPLE).powf(0.25)).clamp(THINNEST, DENSEST);
    let area = (people.max(0.0) / density * 10_000.0).max(LEAST_SETTLED);
    let across = metres(area.sqrt());
    Size {
        height: None,
        width: Some(across / SETTLEMENT_ELONGATION.sqrt()),
        length: Some(across * SETTLEMENT_ELONGATION.sqrt()),
    }
}
/// A crossing spans its river and both abutments; a ford's breadth is its wading line and a
/// bridge's is its deck.
pub fn crossing_size(river_width: f64, breadth: f64, bridged: bool) -> Size {
    let river = river_width.max(LEAST_CROSSING);
    let abutments = if bridged {
        2.0 * (river * ABUTMENT_SHARE).max(LEAST_CROSSING)
    } else {
        0.0
    };
    Size {
        height: None,
        width: Some(metres(breadth)),
        length: Some(metres(river + abutments)),
    }
}
/// A stable roll in [0, 1) from a place's identity, so a place keeps its size wherever it
/// is published.
pub fn roll(id: &str, salt: u64) -> f64 {
    roll_bytes(id.as_bytes(), salt)
}
/// The same roll from an identity's bytes.
pub fn roll_bytes(id: &[u8], salt: u64) -> f64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64 ^ salt.wrapping_mul(0x9e37_79b9_7f4a_7c15);
    for &byte in id {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash ^= hash >> 33;
    hash = hash.wrapping_mul(0xff51_afd7_ed55_8ccd);
    hash ^= hash >> 33;
    (hash >> 11) as f64 / (1u64 << 53) as f64
}
fn rolls(place: &Place) -> [f64; 3] {
    [roll(&place.id, 1), roll(&place.id, 2), roll(&place.id, 3)]
}
/// A length in words a game master reads aloud: metres to one decimal below ten, whole
/// metres below a kilometre, kilometres above.
pub fn length_text(metres: f64) -> String {
    if metres < 10.0 {
        format!("{:.1} m", metres)
    } else if metres < 1_000.0 {
        let step = if metres < 100.0 { 1.0 } else { 10.0 };
        format!("{} m", ((metres / step).round() * step) as i64)
    } else {
        format!("{:.1} km", metres / 1_000.0)
    }
}
/// The size part of a map-key entry.
pub fn size_text(size: &Size) -> Option<String> {
    let extent = match (size.length, size.width) {
        (Some(length), Some(width)) if length >= 1.5 * width => Some(format!(
            "{} long and {} wide",
            length_text(length),
            length_text(width)
        )),
        (Some(length), Some(width)) => {
            Some(format!("about {} across", length_text(length.max(width))))
        }
        (Some(one), None) | (None, Some(one)) => Some(format!("about {} across", length_text(one))),
        (None, None) => None,
    };
    let height = size
        .height
        .filter(|h| *h > 0.0)
        .map(|h| format!("{} high", length_text(h)));
    match (extent, height) {
        (Some(extent), Some(height)) => Some(format!("{extent}, {height}")),
        (one, other) => one.or(other),
    }
}

fn slot<S: State + 'static>(
    statement: &str,
    size: impl Fn(&S, &Place) -> io::Result<Size> + 'static,
) -> Slot<TrueSize<S>> {
    Slot::Value(TrueSize {
        statement: statement.into(),
        size: Rc::new(size),
        represents: Rc::new(|_, _| Ok(1)),
    })
}
/// One real thing of the footprint's reference size.
pub fn sited<S: State + 'static>(footprint: &'static Footprint) -> Slot<TrueSize<S>> {
    slot(
        "One record is one place of roughly real size, rolled from its identity along a long tail.",
        move |_, place| Ok(sited_size(footprint, rolls(place))),
    )
}
/// The extent the place's own cells cover on this map.
pub fn extent<S: State + 'static>() -> Slot<TrueSize<S>> {
    slot(
        "The place is as large as the ground its cells cover on this map.",
        |state: &S, place: &Place| {
            let field = state.field()?;
            let mesh = &field.mesh;
            let [ax, ay] = mesh.position(place.anchor);
            let cells = if place.cells.is_empty() {
                std::slice::from_ref(&place.anchor)
            } else {
                place.cells.as_slice()
            };
            let mut offsets = Vec::with_capacity(cells.len());
            let mut area = 0.0;
            for &cell in cells {
                let [x, y] = mesh.position(cell);
                offsets.push([mesh.delta_x(x - ax), y - ay]);
                area += mesh.area(cell);
            }
            Ok(spread(&offsets, area, field.scale.cells(1.0)))
        },
    )
}
/// A summit: its top's breadth along the long tail and its prominence as height.
pub fn summit<S: State + 'static>(
    prominence: impl Fn(&S, &Place) -> io::Result<f64> + 'static,
) -> Slot<TrueSize<S>> {
    slot(
        "A peak is its summit: the top's breadth, and its prominence as height.",
        move |state, place| {
            let [breadth, shape, _] = rolls(place);
            let across = long_tail(breadth, &SUMMIT);
            Ok(Size {
                height: Some(prominence(state, place)?.max(0.0)),
                width: Some(across),
                length: Some(across * (1.0 + shape)),
            })
        },
    )
}
/// A ford or bridge spans the river it crosses.
pub fn crossing<S: State + 'static>(bridged: bool) -> Slot<TrueSize<S>> {
    slot(
        "A crossing spans its river where it stands, with a wading line or deck across it.",
        move |state: &S, place: &Place| {
            let river = reads::river_width(state.field()?, place.anchor)?;
            let breadth = long_tail(
                roll(&place.id, 1),
                if bridged { &BRIDGE_DECK } else { &FORD_BREADTH },
            );
            Ok(crossing_size(river, breadth, bridged))
        },
    )
}
/// A settlement's built ground from its people.
pub fn settled<S: State + 'static>() -> Slot<TrueSize<S>> {
    slot(
        "A settlement covers the ground its people build on, denser as it grows.",
        |_, place| Ok(settled_size(people(place))),
    )
}
/// A ruin covers what its former people built, or a reference ruin when they are unrecorded.
pub fn ruined<S: State + 'static>() -> Slot<TrueSize<S>> {
    slot("A ruin covers what its former people built.", |_, place| {
        let former = settlement_reads::attribute(place, "peakPopulation", 0.0).max(people(place));
        Ok(if former > 0.0 {
            settled_size(former)
        } else {
            sited_size(&RUIN, rolls(place))
        })
    })
}
fn people(place: &Place) -> f64 {
    place
        .feature
        .as_ref()
        .map_or(0.0, settlement_reads::people_of)
}

/// Why a place of this kind is where it is, in a game master's words.
pub fn reason(kind: Kind) -> &'static str {
    use Kind::*;
    match kind {
        Peak => "A summit standing above its country.",
        Pass => "The low way between higher ground.",
        Ridge => "A long crest of high ground.",
        Escarpment => "A steep step where the ground breaks.",
        Valley => "Low ground opened between heights by running water.",
        Gorge => "A river cut deep into rock between steep walls.",
        Plateau => "High, level ground raised above its edges.",
        Volcano => "A cone built by eruptions.",
        Caldera => "A basin left where a volcano fell in on itself.",
        Crater => "A pit blasted out of the ground.",
        Dome => "A gentle rise pushed up from below.",
        Cirque => "A bowl cut by ice at a valley head.",
        Moraine => "A bank of rubble left by ice.",
        EjectaFan => "Debris thrown out of a blast and spread over the ground.",
        BasaltFlat => "Lava ground left by Fire's flows.",
        SinkholeField => "Ground where the rock beneath has dissolved and fallen in.",
        GlassFlat => "Ground fused to glass.",
        FrostPrism => "Ice grown into prisms by Aurora's cold.",
        BasaltScar => "A scar of black rock where Fire broke through.",
        Spring => "Water rising out of the ground.",
        Waterfall => "A river falling over a step in its bed.",
        Lake => "Standing water held in a basin.",
        RiverMouth => "Where a river meets standing water.",
        Wetland => "Waterlogged ground where water lies at the surface.",
        Fjord => "A long sea inlet in a valley cut by ice.",
        Vent => "Heat and water breaking out of the ground.",
        Oasis => "Green, watered ground in dry country.",
        MeltLine => "Where Aurora's cold gives way to thaw.",
        Pool => "Deep, slow water in a stream.",
        Headland => "High ground running out into the sea.",
        Bay => "Water held in a curve of the coast.",
        Strait => "A narrow passage of sea between two shores.",
        UpwellingFront => "Where deep water rises and feeds the sea.",
        CrushZone => "Sea where Pressure crushes the deep.",
        AncientWake => "The lasting track of an old Pressure surge.",
        RogueWaveImpact => "Shore struck by a wave Pressure raised.",
        PressureLocus => "The deep place Pressure rises from.",
        ThermalVein => "A seam of Fire's heat running through the rock.",
        Placer => "Heavy grains a river has sorted out of its gravel.",
        SaltPan => "A flat crusted with salt.",
        SaltDust => "Ground dusted with salt blown off a pan.",
        KillingGround => "Ground salt has poisoned against growth.",
        Mine => "Workings where people dig the rock.",
        Forest => "Woodland.",
        Grassland => "Open grass country.",
        Barren => "Bare ground where little grows.",
        ThawedHalo => "Ground kept thawed around Fire's heat.",
        WildZone => "Country where Veil's wild outgrows people's hold.",
        Clearance => "Land people cleared to farm.",
        EmberGrove => "Woodland grown on fire-warmed ground.",
        ThawMeadow => "Meadow on ground where the cold has let go.",
        RimeForest => "Woods held in rime by stilling cold.",
        GlowBarrens => "Bare, cold ground lit by glowing lichen.",
        FogHeath => "Heath under standing fog where travellers lose their way.",
        GreenwoodStand => "An old stand Greenwood keeps.",
        VerdantGround => "Country Greenwood keeps unusually green.",
        Deepwood => "Old, dense forest that takes back roads.",
        WendingFen => "Fen whose channels shift.",
        WellMeadow => "Meadow fed by springs.",
        BarrowHeath => "Heath of old barrows over salted ground.",
        AuroraField => "Ground holding Aurora's charge.",
        LightWell => "A well of Aurora's light.",
        CompassDeviation => "Ground where needles swing away from north.",
        InterferenceLattice => "Sea where crossing rays lattice the water.",
        Tear => "A rent where Veil is torn.",
        Door => "A crossing through Veil to somewhere else.",
        FireCore => "The source of Fire beneath the ground.",
        WardRing => "A ring of ground Hallowed holds as sanctuary.",
        WardLine => "A line of ground Hallowed holds.",
        HearthRing | ReadIce | HeldShore | BoundWood | SwornGround | VowedGround => {
            "Ground people work with a craft."
        }
        Settlement => "Where people live.",
        Ruin => "Where people once lived.",
        Dam => "A wall holding back a river.",
        Mill => "A mill driven by water.",
        Irrigation => "Works that lead water onto fields.",
        Harbour => "A sheltered landing for boats.",
        Ford => "Where a way wades a river.",
        Bridge => "Where a way crosses a river on a bridge.",
        Forge => "A forge that works Fire's heat.",
        Archive => "Records kept in ice.",
        Shrine => "A holy place people keep.",
        Battlefield => "Where armies fought.",
        DisasterSite => "Where a disaster struck.",
        CityWall => "A wall the city raised round its built land when it had cause to.",
        CityGate => "Where a way passes through the city's wall.",
        CityPlace => "Where the city's people and ways concentrate enough to raise it.",
        CityDistrict => "A part of the city gathered round one of its centres.",
        MajorWork => "An extraordinary work the city's people sustain.",
    }
}
/// The kind's reason as the place's account.
pub fn account<S: State + 'static>(kind: Kind) -> Slot<OnPlace<S, String>> {
    Slot::Value(Rc::new(move |_, _| Ok(reason(kind).into())))
}
/// A crossing's account names the river it crosses by its width.
pub fn crossing_account<S: State + 'static>(kind: Kind) -> Slot<OnPlace<S, String>> {
    Slot::Value(Rc::new(move |state: &S, place: &Place| {
        let river = reads::river_width(state.field()?, place.anchor)?;
        Ok(if river > 0.0 {
            format!(
                "{} The river runs about {} wide here.",
                reason(kind),
                length_text(river)
            )
        } else {
            reason(kind).into()
        })
    }))
}
/// A settlement's or ruin's account counts its people.
pub fn people_account<S: State + 'static>(kind: Kind) -> Slot<OnPlace<S, String>> {
    Slot::Value(Rc::new(move |_, place: &Place| {
        let now = people(place);
        let former = settlement_reads::attribute(place, "peakPopulation", 0.0);
        Ok(match kind {
            Kind::Settlement if now >= 1.0 => format!("Home to about {} people.", whole(now)),
            Kind::Ruin if former >= 1.0 => {
                format!("Where about {} people once lived.", whole(former))
            }
            _ => reason(kind).into(),
        })
    }))
}
fn whole(people: f64) -> i64 {
    let step = if people < 100.0 {
        1.0
    } else if people < 10_000.0 {
        10.0
    } else {
        100.0
    };
    ((people / step).round() * step) as i64
}
