//! Great-work metatypes describe possible operating programs. Only commissions have geometry.
use super::{Identity, Kind};
use crate::town::{geometry::Point, story::Story, templates::SiteEvidence};
use serde::{Deserialize, Serialize};
mod design;
pub(crate) use design::Part;
pub use design::WorkDesign;
use design::{Axis, Layout, Program, Role, Station};
use Identity::*;
use Layout::*;
use Station::*;

pub(crate) struct Definition {
    pub key: &'static str,
    pub label: &'static str,
    pub locate: fn(&SiteEvidence, &Story) -> Option<Point>,
    pub additional_sites: fn(&SiteEvidence) -> Vec<Point>,
    pub counterpart: fn(&SiteEvidence) -> Option<Point>,
    pub custodians: &'static [Kind],
    axis: Axis,
    pub kept_door: bool,
    core: &'static [Role],
    programs: &'static [Program],
}
const fn role(
    label: &'static str,
    identity: Identity,
    frontage: f64,
    depth: f64,
    station: Station,
) -> Role {
    Role {
        label,
        use_: Kind(identity),
        frontage,
        depth,
        station,
    }
}
macro_rules! works {
    ($( $id:ident ($key:literal, $label:literal, $site:expr, $counterpart:expr, $axis:ident, $door:expr, [$($cust:ident),+],
        [$(($core:literal, $use:ident, $w:expr, $d:expr, $st:ident)),+],
        [$(($program:literal, $layout:ident, $ground:literal, $station:ident,
            ($r:literal,$k:ident), ($support:literal,$sk:ident))),+] $(, $additional:expr)? )),+ $(,)?) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
        pub enum WorkFamily { $($id),+ }
        impl WorkFamily {
            pub const ALL: &'static [Self] = &[$(Self::$id),+];
            pub(crate) fn definition(self) -> &'static Definition {
                match self { $(Self::$id => { const DEF: Definition = Definition {
                    key:$key, label:$label, locate:$site, counterpart:$counterpart,
                    additional_sites:works!(@sites $($additional)?),
                    custodians:&[$(Kind($cust)),+], axis:Axis::$axis, kept_door:$door,
                    core:&[$(role($core,$use,$w,$d,$st)),+],
                    programs:&[$(Program { label:$program, layout:$layout, grounds:$ground,
                        primary:role($r,$k,29.,35.,$station), support:role($support,$sk,20.,25.,$station) }),+]
                }; &DEF }),+ }
            }
            pub fn key(self) -> &'static str { self.definition().key }
            pub fn label(self) -> &'static str { self.definition().label }
            pub fn from_key(key: &str) -> Option<Self> { Self::ALL.iter().copied().find(|f| f.key()==key) }
        }
    };
    (@sites) => { |_| vec![] };
    (@sites $more:expr) => { $more };
}

// owner-direction(2026-11-19): great works are meta types only, with significant variation per type and no set proper name.
works! {
    Library("library","Library", |s,_| Some(s.works.ice_record.or(s.institution).unwrap_or(s.centre)), |_| None, Free, false, [Learning,GuildHall],
        [("Repository",Learning,32.,42.,Land),("Copyists' workshop",DomesticCraft,19.,27.,Land)],
        [("Public lending",Court,"Readers' courtyard",Land,("Lending hall",AssemblyHall),("Bookbinders' stalls",Storehouse)),
         ("Legal deposit",Spine,"Witnesses' passage",Land,("Testimony chamber",CourtHouse),("Petitioners' lodgings",Inn)),
         ("Scholarly college",Cloister,"Teaching cloister",Land,("Lecture theatre",Learning),("Fellows' lodgings",Inn))],
         |s| s.institution.into_iter().chain(s.witness).chain([s.centre]).collect()),
    Palace("palace","Palace", |s,_| s.seat.then_some(s.institution.unwrap_or(s.centre)), |_| None, Approach, false, [Manor,CourtHouse],
        [("Royal apartments",Manor,42.,52.,Land),("Service court",CarrierYard,25.,33.,Land)],
        [("Audience court",Spine,"Processional avenue",Land,("Hall of petitions",CourtHouse),("Envoys' lodge",Inn)),
         ("Pleasure residence",Court,"Pleasure garden",Land,("Festival pavilion",Entertainment),("Gardeners' yard",Garden)),
         ("Fortified residence",Cloister,"Muster ward",Land,("Guard barracks",Watch),("Provision magazine",Storehouse))]),
    Prison("prison","Prison", |s,_| (s.guarded && s.door.is_none()).then_some(s.upper.or(s.shore)).flatten(), |s| s.lower, Facing, false,[Watch,CourtHouse],
        [("Gatehouse",Watch,18.,30.,Land),("Cell block",Watch,36.,45.,Land)],
        [("Judicial custody",Court,"Visitors' court",Land,("Hearing rooms",CourtHouse),("Advocates' lodging",Inn)),
         ("Penal labor",Spine,"Guarded work lane",Land,("Convict workshops",HeavyCraft),("Tool store",Storehouse)),
         ("Isolated confinement",Cloister,"Patrol circuit",Land,("Infirmary",Healer),("Food transfer yard",CarrierYard))]),
    RockMonument("rockMonument","Rock monument", |s,_| s.upper, |s| s.lower, Facing, false, [ResourceYard,HeavyCraft],
        [("Rock cutting",ResourceYard,57.,26.,Land),("Carvers' workshop",HeavyCraft,28.,32.,Land)],
        [("Memorial relief",Spine,"Commemorative approach",Land,("Funerary terrace",Burial),("Mourners' shelter",Inn)),
         ("Pilgrimage sculpture",Terrace,"Votive steps",Land,("Votive sanctuary",Worship),("Pilgrims' kitchens",Cookshop)),
         ("Public colossus",Court,"Viewing apron",Land,("Assembly terrace",AssemblyHall),("Stone dressing yard",ResourceYard))]),
    Shipyard("shipyard","Shipyard", |s,_| s.works.timber.and(s.works.deep_water).and(s.shore), |s| s.works.deep_water, Waterfront, false,[Landing,HeavyCraft],
        [("Launch slips",Landing,25.,53.,Land),("Timber yard",ResourceYard,34.,39.,Land)],
        [("Naval construction",Spine,"Keel ways",Land,("Naval fitting shed",HeavyCraft),("Armoury",Smithy)),
         ("Merchant refit",Court,"Cargo basin",Land,("Chandlers' exchange",ExchangeHall),("Bonded warehouse",Storehouse)),
         ("Boatbuilding guild",Terrace,"Hauling terraces",Land,("Apprentices' workshop",GuildHall),("Ropemakers' shed",DomesticCraft))]),
    LakeSanctuary("lakeSanctuary","Lake sanctuary", |s,_| s.institution.and(s.works.lake_shore), |s| s.afloat, Waterfront, false,[Worship,ReligiousHouse],
        [("Ritual landing",Landing,24.,29.,Land),("Shore sanctuary",Worship,34.,35.,Land)],
        [("Festival pilgrimage",Court,"Feast ground",Land,("Communal kitchens",Cookshop),("Pilgrims' hospice",Almshouse)),
         ("Monastic retreat",Cloister,"Meditation walk",Land,("Monastic cells",ReligiousHouse),("Physic garden",Garden)),
         ("Water procession",Spine,"Embarkation avenue",Land,("Boat stewards' hall",GuildHall),("Ceremonial stores",Storehouse))]),
    Floodworks("floodworks","Floodworks", |s,_| s.cultivated.then_some(s.works.floodplain).flatten(), |_| None, Approach, false,[WaterPoint,WashHouse,Mill],
        [("Catch basin",Common,40.,39.,Land),("Discharge steps",WaterPoint,26.,39.,Land)],
        [("Flood diversion",Spine,"Relief channel",Land,("Sluice keepers' yard",ResourceYard),("Emergency stores",Storehouse)),
         ("Public bathing",Court,"Bathing basin",Land,("Public wash house",WashHouse),("Water stewards' hall",AssemblyHall)),
         ("Field irrigation",Terrace,"Irrigation terraces",Land,("Water allocation court",CourtHouse),("Ditch crews' yard",CarrierYard))]),
    SacredGrove("sacredGrove","Sacred grove", |s,_| s.grove, |_| None, Free, false,[Garden,Healer,CraftPractice],
        [("Protected root stand",Park,25.,53.,Land),("Tenders' lodge",Healer,19.,24.,Land)],
        [("Grove council",Court,"Assembly clearing",Land,("Moot hall",AssemblyHall),("Delegates' lodging",Inn)),
         ("Healing grove",Cloister,"Physic walk",Land,("Healing garden",Garden),("Convalescent shelter",Almshouse)),
         ("Ancestor grove",Terrace,"Memorial terraces",Land,("Burial enclosure",Burial),("Keeper's shrine",Shrine))]),
    SoundingStation("soundingStation","Sounding station", |s,_| (s.practice[2]>0.).then_some(s.works.deep_water.and(s.shore)).flatten(), |s| s.works.deep_water, Waterfront, false,[Landing,CraftPractice],
        [("Dive landing",Landing,21.,28.,Land),("Offshore listening station",Watch,19.,26.,FarWater)],
        [("Navigation survey",Spine,"Survey baseline",Land,("Chart room",Learning),("Pilots' hall",GuildHall)),
         ("Harbor warning",Terrace,"Signal terraces",Land,("Signal watch",Watch),("Messengers' yard",CarrierYard)),
         ("Diving school",Court,"Training court",Land,("Divers' school",Learning),("Diving infirmary",Healer))]),
    SaltMemorial("saltMemorial","Salt memorial", |s,_| s.works.salt_pan, |_| None, Free, false,[Burial,CourtHouse,CraftPractice],
        [("Raking pan",Common,46.,40.,Land),("Witness hall",CourtHouse,29.,32.,Land)],
        [("Ancestral testimony",Spine,"Barrow avenue",Land,("Memorial vault",Burial),("Family lodging",Inn)),
         ("Oath registry",Court,"Oath-taking court",Land,("Depository",Storehouse),("Record school",Learning)),
         ("Ritual remembrance",Cloister,"Memorial circuit",Land,("Offering chapel",Shrine),("Mourners' kitchen",Cookshop))]),
    PortalHostel("portalHostel","Portal hostel", |s,_| s.works.paired_door.and(s.door), |s| s.works.paired_door, Facing, true,[Inn,ExchangeHall,CraftPractice],
        [("Reception house",Inn,29.,33.,Land),("Partner reception",Inn,26.,28.,FarLand)],
        [("Freight interchange",Spine,"Transfer lane",Land,("Bonded goods hall",ExchangeHall),("Carriers' stables",CarrierYard)),
         ("Travelers' hospice",Cloister,"Recovery garden",Land,("Recovery ward",Healer),("Communal kitchen",Cookshop)),
         ("Diplomatic crossing",Court,"Envoys' forecourt",Land,("Audience chamber",CourtHouse),("Dispatch archive",Storehouse))]),
    Sanctuary("sanctuary","Sanctuary", |s,_| s.vowed.then_some(s.institution.unwrap_or(s.centre)), |_| None, Approach, false,[ReligiousHouse,Almshouse,Shrine],
        [("Refuge house",Almshouse,30.,33.,Land),("Custodians' house",ReligiousHouse,25.,34.,Land)],
        [("Negotiated sanctuary",Court,"Petitioners' ground",Land,("Mediation hall",CourtHouse),("Envoys' kitchen",Cookshop)),
         ("Pilgrims' refuge",Cloister,"Asylum circuit",Land,("Wayside hospice",Healer),("Chapel",Shrine)),
         ("Refugee settlement",Spine,"Distribution street",Land,("Provision depot",Storehouse),("Public ovens",Cookshop))]),
    ThermalRefuge("thermalRefuge","Thermal refuge", |s,story| (story.pass && s.works.frost && s.medium[0]>0.).then_some(s.industry.unwrap_or(s.centre)), |_| None, Approach, false,[Smithy,CarrierYard,CraftPractice],
        [("Banked hearth",Smithy,25.,27.,Land),("Fuel store",Storehouse,27.,33.,Land)],
        [("Winter convoy",Spine,"Sheltered haul road",Land,("Convoy lodging",Inn),("Sled yard",CarrierYard)),
         ("Mountain hospice",Court,"Warm refuge court",Land,("Frost ward",Healer),("Refuge kitchen",Cookshop)),
         ("Thermal workshop",Terrace,"Furnace terraces",Land,("Hot workshop",HeavyCraft),("Artisans' lodge",GuildHall))]),
    FloatingHall("floatingHall","Floating hall", |s,_| s.shore.and(s.afloat), |s| s.shore, Facing, false,[Landing,AssemblyHall],
        [("Common deck",AssemblyHall,18.,39.,Water),("Service barge",Storehouse,16.,32.,Water)],
        [("Floating exchange",Spine,"Cargo fairway",Water,("Weighing deck",ExchangeHall),("Factors' lodge",Inn)),
         ("Council flotilla",Court,"Council pool",Water,("Delegates' hull",GuildHall),("Hospitality barge",Cookshop)),
         ("Fleet memorial",Cloister,"Memorial mooring",Water,("Archive ship",Learning),("Chapel ship",Shrine))]),
    Observatory("observatory","Observatory", |s,_| Some(s.centre), |_| None, Cardinal, false,[Learning,AssemblyHall],
        [("Observing platform",Learning,23.,28.,Land),("Reference marker",Common,14.,26.,Land)],
        [("Meridian survey",Spine,"Meridian baseline",Land,("Surveyors' hall",GuildHall),("Instrument workshop",DomesticCraft)),
         ("Calendar observatory",Court,"Calendar court",Land,("Calendar hall",AssemblyHall),("Ephemeris archive",Storehouse)),
         ("Teaching observatory",Terrace,"Observation terraces",Land,("Lecture theatre",Learning),("Students' hostel",Inn))],
         |s| s.upper.into_iter().chain(s.institution).collect())
}
