use serde::{Deserialize, Serialize};

macro_rules! names {
    ($name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
        pub enum $name { $(#[serde(rename = $text)] $variant),+ }
        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];
            pub fn as_str(self) -> &'static str { match self { $(Self::$variant => $text),+ } }
        }
    };
}
names!(Group { Relief => "relief", Water => "water", Sea => "sea", Ground => "ground", Cover => "cover", Anomalies => "anomalies", Settlements => "settlements" });
names!(AreaKind { River => "river", Fault => "fault", Ocean => "ocean", Range => "range", Road => "road", Lane => "lane", Polity => "polity", PoliticalRegion => "politicalRegion" });
names!(Kind {
    Peak => "peak", Pass => "pass", Ridge => "ridge", Escarpment => "escarpment", Valley => "valley", Gorge => "gorge", Plateau => "plateau",
    Volcano => "volcano", Caldera => "caldera", Crater => "crater", Dome => "dome", Cirque => "cirque", Moraine => "moraine", EjectaFan => "ejectaFan",
    BasaltFlat => "basaltFlat", SinkholeField => "sinkholeField", GlassFlat => "glassFlat", FrostPrism => "frostPrism", BasaltScar => "basaltScar",
    Spring => "spring", Waterfall => "waterfall", Lake => "lake", RiverMouth => "riverMouth", Wetland => "wetland", Fjord => "fjord", Vent => "vent", Oasis => "oasis", MeltLine => "meltLine", Pool => "pool",
    Headland => "headland", Bay => "bay", Strait => "strait", UpwellingFront => "upwellingFront", CrushZone => "crushZone", AncientWake => "ancientWake", RogueWaveImpact => "rogueWaveImpact", PressureLocus => "pressureLocus",
    ThermalVein => "thermalVein", Placer => "placer", SaltPan => "saltPan", SaltDust => "saltDust", KillingGround => "killingGround", Mine => "mine",
    Forest => "forest", Grassland => "grassland", Barren => "barren", ThawedHalo => "thawedHalo", WildZone => "wildZone", Clearance => "clearance", EmberGrove => "emberGrove", ThawMeadow => "thawMeadow", RimeForest => "rimeForest", GlowBarrens => "glowBarrens", FogHeath => "fogHeath", GreenwoodStand => "greenwoodStand", VerdantGround => "verdantGround", Deepwood => "deepwood", WendingFen => "wendingFen", WellMeadow => "wellMeadow", BarrowHeath => "barrowHeath",
    AuroraField => "auroraField", LightWell => "lightWell", CompassDeviation => "compassDeviation", InterferenceLattice => "interferenceLattice", Tear => "tear", Door => "door", FireCore => "fireCore", WardRing => "wardRing", WardLine => "wardLine", HearthRing => "hearthRing", ReadIce => "readIce", HeldShore => "heldShore", BoundWood => "boundWood", SwornGround => "swornGround", VowedGround => "vowedGround",
    Settlement => "settlement", Ruin => "ruin", Dam => "dam", Mill => "mill", Irrigation => "irrigation", Harbour => "harbour", Ford => "ford", Bridge => "bridge", Forge => "forge", Archive => "archive", Shrine => "shrine", Battlefield => "battlefield", DisasterSite => "disasterSite"
});
impl Kind {
    pub fn group(self) -> Group {
        use Kind::*;
        match self {
            Peak | Pass | Ridge | Escarpment | Valley | Gorge | Plateau | Volcano | Caldera
            | Crater | Dome | Cirque | Moraine | EjectaFan | BasaltFlat | SinkholeField
            | GlassFlat | FrostPrism | BasaltScar => Group::Relief,
            Spring | Waterfall | Lake | RiverMouth | Wetland | Fjord | Vent | Oasis | MeltLine
            | Pool => Group::Water,
            Headland | Bay | Strait | UpwellingFront | CrushZone | AncientWake
            | RogueWaveImpact | PressureLocus => Group::Sea,
            ThermalVein | Placer | SaltPan | SaltDust | KillingGround | Mine => Group::Ground,
            Forest | Grassland | Barren | ThawedHalo | WildZone | Clearance | EmberGrove
            | ThawMeadow | RimeForest | GlowBarrens | FogHeath | GreenwoodStand | VerdantGround
            | Deepwood | WendingFen | WellMeadow | BarrowHeath => Group::Cover,
            AuroraField | LightWell | CompassDeviation | InterferenceLattice | Tear | Door
            | FireCore | WardRing | WardLine | HearthRing | ReadIce | HeldShore | BoundWood
            | SwornGround | VowedGround => Group::Anomalies,
            Settlement | Ruin | Dam | Mill | Irrigation | Harbour | Ford | Bridge | Forge
            | Archive | Shrine | Battlefield | DisasterSite => Group::Settlements,
        }
    }
}
