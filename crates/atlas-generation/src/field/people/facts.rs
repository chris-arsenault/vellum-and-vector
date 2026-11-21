// Arconis: docs/architecture/subsystems.arconis#item=pp_loose — pass settings, including one loose-people pass per epoch.
#[derive(Clone, Copy)]
pub struct Facts {
    pub years: f64,
    pub mobility: f64,
    pub sweeps: usize,
    pub range: f64,
    pub farms: bool,
    pub builds: bool,
    pub learns: bool,
    pub grows: bool,
}
impl Facts {
    pub fn loose(years: f64) -> Self {
        Self {
            years,
            mobility: 0.05,
            sweeps: 1,
            range: 0.005,
            farms: false,
            builds: false,
            learns: true,
            grows: true,
        }
    }
    pub fn settled(years: f64, mobility: f64) -> Self {
        Self {
            years,
            mobility: (0.25 * mobility.max(0.0)).min(0.6),
            sweeps: 3,
            range: 0.03,
            farms: true,
            builds: true,
            learns: true,
            grows: true,
        }
    }
}
// Arconis: docs/architecture/subsystems.arconis#item=pp_era — sets how many settled passes the human era runs.
pub fn passes_for(years: f64) -> usize {
    (years / 100.0).ceil().clamp(2.0, 6.0) as usize
}
pub const GROWTH_RATE: f64 = 0.02;
pub const HUNGER_YEARS: f64 = 30.0;
pub const PRESSURE: f64 = 0.25;
/// How much faster than its size a concentrated town pulls people in: the old society cycle's
/// town pull grew as town size to the power 1.3.
pub const CONCENTRATION: f64 = 0.3;
pub const MARKET_SHARE: f64 = 0.2;
pub const CLEARING_YEARS: f64 = 50.0;
pub const PEOPLE_PER_BUILT_KM2: f64 = 8000.0;
pub const BUILDING_YEARS: f64 = 50.0;
pub const WORKS_YEARS: f64 = 300.0;
pub const FOUNDERS: f64 = 0.3;

// The settings of the society's rules, each read by the one step that applies it.

// Survivors' flight (`flight.rs`).
/// The share of a struck place's survivors who flee, at full severity.
pub const FLEEING: f64 = 0.6;
/// How far survivors go looking for room, as a share of the map's span over open ground: a
/// few days' walk, beyond their own town to the country and towns beside it, as the old
/// society cycle moved them to a neighbouring community.
pub const FLIGHT: f64 = 0.05;

// Strikes and sieges (`land_events.rs`).
/// How hard a siege wears the place it takes. With the magnitude's six to nine tenths, the
/// old society cycle's siege magnitudes, it kills about a fifth of an unbuilt town; a town's
/// standing holds its people against the wear as it holds them against any blow, so walls
/// count once.
pub const SIEGE_WEAR: f64 = 0.5;
/// A siege's magnitude where the losing realm still holds together, and where it has
/// collapsed: the old society cycle struck fragmented realms at six tenths and collapsed ones
/// at nine.
pub const SIEGE_STANDING: f64 = 0.6;
pub const SIEGE_FALLEN: f64 = 0.9;
/// How hard a meeting at full severity wears the living ground it strikes. Through the
/// shake-and-burn mix this takes about a fifth of the people there, as the old society
/// cycle's hazards killed a fifth of a community at full severity.
pub const MEETING_WEAR: f64 = 0.5;

// Tongues (`identity_era.rs`, `travel.rs`).
/// The share of the people a tongue reaches who learn it as a second tongue; the rest take it
/// up as their own and keep the one they spoke as a tongue they know.
pub const LEARNING: f64 = 2.0 / 3.0;
/// The share of the people on and around a cell who must speak a tongue for those who know it
/// there to keep it.
pub const KEPT_BY_USE: f64 = 0.01;
/// How long an unused tongue takes to fade, in years: the old society cycle's 300.
pub const FORGETTING_YEARS: f64 = 300.0;
/// How much easier people's country is to cross where all of them understand the tongue
/// spoken around them.
pub const SHARED_SPEECH: f64 = 0.3;

// Ways (`travel.rs`).
/// The traffic, in traveller-years, over which a way wears its ground most of the way it
/// will, and at which people grade its climbs.
pub const WORN: f64 = 50_000.0;
/// How much of a climb's cost and steepness a graded road takes away.
pub const GRADING: f64 = 0.5;

// Realms (`realm_era.rs`, `realm_seats.rs`, `traditions.rs`).
/// How close a runner-up's hold must come to the holder's for a town to be contested: the
/// old society cycle's runner-up above four fifths of the leader.
pub const CONTESTED: f64 = 0.8;
/// How much of a realm's hold full ruin leaves: the old society cycle reached ruined
/// communities at a quarter.
pub const RUIN_HOLD: f64 = 0.25;
/// How much more cheaply a challenger must hold ground than the realm already holding it to
/// take it: a realm keeps what it holds unless another holds it far more cheaply.
pub const KEEPING: f64 = 0.6;
/// How much a full temple or academy in a realm's town adds to the realm's strength: the old
/// society cycle's institutional influence.
pub const INFLUENCE: f64 = 0.1;
/// How much larger than its seat a town of the realm must grow to draw the seat to itself.
pub const SEAT_INERTIA: f64 = 1.5;
/// How fast a realm's health follows its holding, in years.
pub const HEALTH_YEARS: f64 = 80.0;
/// The health a successor realm begins with: the old society cycle's 0.65.
pub const SUCCESSOR_HEALTH: f64 = 0.65;

// A realm's character (`realm_character.rs`).
/// The share of a realm's people who must keep a craft for the realm to be named by it.
pub const CRAFT_KEPT: f64 = 1.0 / 3.0;
/// The share of a realm's food a livelihood must give for the realm to be named by it.
pub const LIVING_BY: f64 = 0.5;
/// The share who must speak or know a tongue for it to count among the realm's tongues.
pub const IN_COMMON: f64 = 0.1;
/// How many tongues in common make a realm a concord.
pub const CONCORD: usize = 3;

// Seeking (`seeking.rs`).
/// How much draw a craft's whole people add or take where its medium is full or absent.
pub const SEEKING: f64 = 0.5;

// Goods (`goods.rs`).
/// How much of materials, of wares, and of all the crafts' goods together a person wants a
/// year, in goods: the measure every amount of goods is counted in.
pub const WANTED_MATERIALS: f64 = 0.05;
pub const WANTED_WARES: f64 = 0.05;
pub const WANTED_CRAFTED: f64 = 0.02;
/// The share of a cell's people who make goods for others, where the means suffice.
pub const MAKERS: f64 = 0.2;
/// How many makers a km² of fully offered means employs: a mine, a salt pan or a mill gives
/// work to so many and no more, however many people live around it. A town of a thousand to
/// the km² over a full mine can then send half its makers' goods away.
pub const WORKABLE: f64 = 100.0;
/// How much a maker makes a year, in goods: enough of materials or wares for twenty people.
pub const MADE: f64 = 1.0;
/// How much more a trading cell pulls people than its offers alone would, at full trade.
pub const TRADING: f64 = 0.6;
/// How much more wealth a trading built place gathers toward, at full trade.
pub const WEALTH: f64 = 1.0;
/// How many goods one traveller carries on a trip, by pack and cart.
pub const CARRIED: f64 = 100.0;
