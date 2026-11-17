use super::{
    contract::Entry,
    event_relief,
    fall_size::{self, FallState},
    kinds::{Group, Kind},
    magic_kinds, reads, shore_form,
    values::Place,
};
use crate::{
    features::State as FeatureState,
    field::{
        events::Event,
        region_evidence::{region_evidence, Evidence},
        shared::Scalar,
        significance::{self, measure, physical, Extent},
    },
    magic::{channels::Channel, configuration::Cartography, state::MagicField},
    scale::{LengthUnit, MapScale},
    water::column::Store,
};
use std::io;

pub trait RealizationState: FallState + super::river_courses::RiverState {
    fn extent(&self) -> io::Result<Extent>;
    fn impact_visible_relief(&self) -> f64;
}
const RISE: f64 = 0.00015;
const COURSE_LENGTH: f64 = 0.025;
const COURSE_RELIEF: f64 = 0.000075;
const COMPLEX_AREA: f64 = 0.0005;
const COMPLEX_RELIEF: f64 = 0.000075;
const FJORD_LENGTH: f64 = 0.02;
const FJORD_BREADTH: f64 = 0.002;
const LAKE_AREA: f64 = 0.000125;
const VOLCANO_RELIEF: f64 = 0.00025;
const CRATER_RELIEF: f64 = 0.0000375;
const CRATER_RADIUS: f64 = 0.00375;
const CLEAR_FORM: f64 = 0.7;
const STRONG_TIE: f64 = 0.45;
const EXCEPTIONAL_FIRE_SOURCE: f64 = 600.0;
const EXCEPTIONAL_GEOTHERMAL: f64 = 400.0;
const EXCEPTIONAL_ICE_THICKNESS: f64 = 0.000125;
const EXCEPTIONAL_ICE_CHARGE: f64 = 0.8;
const MAGICAL_COURSE_LENGTH: f64 = 0.025;
const MAGICAL_COURSE_COVERAGE: f64 = 0.5;
const FALLS_WIDTH: f64 = 0.000125;
// Real sizes on a real-scale map (ADR 0016), where a place exists by its own size rather than
// by its share of the world: a col a walker climbs to, a valley or ridge a few hundred metres
// long, a pond, a step in a stream.
/// A pass's col rise, metres.
const REAL_RISE: f64 = 20.0;
/// A ridge's, escarpment's, valley's or gorge's length and relief, metres.
const REAL_COURSE_LENGTH: f64 = 300.0;
const REAL_COURSE_RELIEF: f64 = 15.0;
/// A plateau's, dome's, cirque's or moraine's area (square metres) and relief (metres).
const REAL_COMPLEX_AREA: f64 = 50_000.0;
const REAL_COMPLEX_RELIEF: f64 = 15.0;
/// A lake by area alone, square metres; a smaller water down to the exceptional area is a lake
/// when it is deep or feeds a stream (metres; cubic metres a second).
const REAL_LAKE_AREA: f64 = 2_000.0;
const REAL_EXCEPTIONAL_LAKE_AREA: f64 = 300.0;
const REAL_LAKE_DEPTH: f64 = 3.0;
const REAL_OUTLET_DISCHARGE: f64 = 0.1;
/// A waterfall's drop or breadth, metres.
const REAL_FALLS_DROP: f64 = 3.0;
const REAL_FALLS_WIDTH: f64 = 15.0;
fn evidence(state: &impl RealizationState, place: &Place) -> io::Result<Evidence> {
    region_evidence(state.field()?, &place.cells, |_| Ok(1.0), |_| true)
}
fn course(state: &impl RealizationState, place: &Place) -> io::Result<bool> {
    let e = evidence(state, place)?;
    let scale = &state.field()?.scale;
    Ok(
        e.span >= physical(scale, COURSE_LENGTH, 1, 1.0, REAL_COURSE_LENGTH)?
            && e.relief >= physical(scale, COURSE_RELIEF, 1, 0.5, REAL_COURSE_RELIEF)?,
    )
}
fn complex(state: &impl RealizationState, place: &Place) -> io::Result<bool> {
    let e = evidence(state, place)?;
    let scale = &state.field()?.scale;
    Ok(
        e.area >= physical(scale, COMPLEX_AREA, 2, 1.0, REAL_COMPLEX_AREA)?
            && e.relief >= physical(scale, COMPLEX_RELIEF, 1, 0.5, REAL_COMPLEX_RELIEF)?,
    )
}
fn lake(state: &impl RealizationState, place: &Place) -> io::Result<bool> {
    let field = state.field()?;
    let scale = &field.scale;
    let area = evidence(state, place)?.area;
    if area >= physical(scale, LAKE_AREA, 2, 1.0, REAL_LAKE_AREA)? {
        return Ok(true);
    }
    let least = physical(
        scale,
        significance::EXCEPTIONAL_LAKE_AREA,
        2,
        1.0,
        REAL_EXCEPTIONAL_LAKE_AREA,
    )?;
    if area < least {
        return Ok(false);
    }
    let depth = field.water().column.store(Store::Standing).contents();
    let (mut deepest, mut flow) = (0.0f64, 0.0f64);
    for &cell in &place.cells {
        deepest = deepest.max(MapScale::metres(depth.get(cell)?, LengthUnit::Native));
        flow = flow.max(reads::discharge(field, cell)?);
    }
    Ok(
        deepest >= physical(scale, significance::LAKE_DEPTH, 1, 0.5, REAL_LAKE_DEPTH)?
            || flow
                >= physical(
                    scale,
                    significance::OUTLET_DISCHARGE,
                    3,
                    1.0,
                    REAL_OUTLET_DISCHARGE,
                )?,
    )
}
fn event<'a>(state: &'a impl RealizationState, place: &Place) -> io::Result<Option<&'a Event>> {
    Ok(state
        .field()?
        .events
        .iter()
        .find(|event| place.id.starts_with(&event.id)))
}
fn volcano(state: &impl RealizationState, place: &Place) -> io::Result<bool> {
    let Some(event) = event(state, place)? else {
        return Ok(true);
    };
    Ok(event_relief::volcanic(state.field()?, event)?
        >= measure(&state.field()?.scale, VOLCANO_RELIEF, 1, 0.5)?)
}
fn crater(state: &impl RealizationState, place: &Place) -> io::Result<bool> {
    let Some(event) = event(state, place)? else {
        return Ok(true);
    };
    let field = state.field()?;
    let relief = event_relief::crater(field, event)?;
    Ok(
        event.radius >= measure(&field.scale, CRATER_RADIUS, 1, 1.0)?
            && relief >= measure(&field.scale, CRATER_RELIEF, 1, 0.5)?
            && relief >= state.impact_visible_relief(),
    )
}
fn below_world(state: &impl RealizationState, place: &Place) -> bool {
    !state.world_geography()
        || place
            .feature
            .as_ref()
            .is_some_and(|feature| feature.state == FeatureState::Authored)
}
fn landscape_kind(kind: Kind) -> Option<&'static str> {
    use Kind::*;
    Some(match kind {
        Wetland => "wetland",
        Forest => "forest",
        Grassland => "grassland",
        Barren => "barren",
        EmberGrove => "ember",
        ThawMeadow => "thaw",
        RimeForest => "rime",
        GlowBarrens => "glow",
        FogHeath => "fog",
        Deepwood => "deepwood",
        WendingFen => "wending",
        WellMeadow => "well",
        BarrowHeath => "barrow",
        SaltPan => "pan",
        Placer => "magic",
        _ => return None,
    })
}
fn gate(state: &impl RealizationState, kind: Kind, place: &Place) -> io::Result<bool> {
    use Kind::*;
    let field = state.field()?;
    if let Some(landscape) = landscape_kind(kind) {
        return Ok(significance::landscape(
            &state.extent()?,
            landscape,
            &evidence(state, place)?,
            &field.scale,
        )?
        .publish);
    }
    match kind {
        Pass => {
            let cols = state.held().get("relief:keyCols", || field.key_cols())?;
            let rise = physical(&field.scale, RISE, 1, 0.5, REAL_RISE)?;
            Ok(cols.get(place.anchor)? >= MapScale::native(rise))
        }
        Ridge | Escarpment | Valley | Gorge => course(state, place),
        Plateau | Dome | Cirque | Moraine => complex(state, place),
        Volcano | Caldera => volcano(state, place),
        Crater => crater(state, place),
        Waterfall => {
            if place.origin.as_deref() == Some("carried") {
                return Ok(true);
            }
            let size = fall_size::of(state, place)?;
            let drop = physical(
                &field.scale,
                significance::FALLS_DROP,
                1,
                0.5,
                REAL_FALLS_DROP,
            )?;
            let width = physical(&field.scale, FALLS_WIDTH, 1, 1.0, REAL_FALLS_WIDTH)?;
            Ok(size.height >= drop || size.width >= width)
        }
        Fjord => {
            let e = evidence(state, place)?;
            Ok(e.span >= measure(&field.scale, FJORD_LENGTH, 1, 1.0)?
                && e.breadth >= measure(&field.scale, FJORD_BREADTH, 1, 1.0)?)
        }
        Lake => lake(state, place),
        Headland | Bay | Strait => Ok(shore_form::at(state, place.anchor)?.wrap >= CLEAR_FORM),
        Mine | Shrine | Forge | Archive | Harbour | Irrigation | Clearance | Mill | Ford
        | Bridge => Ok(below_world(state, place)),
        Dam => Ok(below_world(state, place)
            || place
                .feature
                .as_ref()
                .and_then(|feature| feature.attributes.get("resolved"))
                .and_then(|v| v.as_bool())
                == Some(true)),
        _ => Ok(true),
    }
}
fn exceptional_source(
    state: &impl RealizationState,
    magic: &MagicField,
    rule: usize,
    cell: usize,
) -> io::Result<bool> {
    let field = state.field()?;
    let source = magic.channel(Channel::Source).get(cell)?;
    let rule = &magic.definition().features[rule];
    Ok(match magic.definition().id.as_str() {
        "fire" => {
            source >= EXCEPTIONAL_FIRE_SOURCE
                && field.shared.scalar(Scalar::Geothermal).get(cell)? >= EXCEPTIONAL_GEOTHERMAL
        }
        "aurora" => {
            field.shared.scalar(Scalar::IceThickness).get(cell)?
                >= measure(&field.scale, EXCEPTIONAL_ICE_THICKNESS, 1, 0.5)?
                && field.shared.scalar(Scalar::IceCharge).get(cell)? >= EXCEPTIONAL_ICE_CHARGE
        }
        "pressure" => rule.id == "locus" && source > 0.0,
        "greenwood" => {
            reads::discharge(field, cell)?
                >= measure(&field.scale, significance::RIVER_DISCHARGE, 3, 1.0)?
                && source > 0.0
        }
        "veil" => {
            rule.id == "door"
                && magic
                    .definition()
                    .origins
                    .iter()
                    .position(|o| o.id == "door")
                    .map(|at| magic.origin_source(at).get(cell))
                    .transpose()?
                    .unwrap_or(0.0)
                    > 0.0
        }
        _ => false,
    })
}
fn magic_place(
    state: &impl RealizationState,
    magic: &MagicField,
    rule: usize,
    place: &Place,
) -> io::Result<bool> {
    let cartography = magic.definition().features[rule].cartography;
    if matches!(cartography, Some(Cartography::Site)) {
        for &cell in &place.cells {
            if exceptional_source(state, magic, rule, cell)? {
                return Ok(true);
            }
        }
    }
    let coverage = magic.feature(rule).1;
    let e = region_evidence(
        state.field()?,
        &place.cells,
        |cell| coverage.get(cell),
        |_| true,
    )?;
    if matches!(cartography, Some(Cartography::Course)) {
        return Ok(
            e.span >= measure(&state.field()?.scale, MAGICAL_COURSE_LENGTH, 1, 1.0)?
                && e.strength >= MAGICAL_COURSE_COVERAGE,
        );
    }
    Ok(significance::landscape(&state.extent()?, "magic", &e, &state.field()?.scale)?.publish)
}
fn grown_by<'a>(
    state: &'a impl RealizationState,
    kind: Kind,
    place: &Place,
) -> io::Result<Option<(std::cell::Ref<'a, MagicField>, usize)>> {
    let Some(fields) = state.magic() else {
        return Ok(None);
    };
    for (index, field) in fields.iter().enumerate() {
        for (at, rule) in field.definition().features.iter().enumerate() {
            if magic_kinds::kind(&field.definition().id, &rule.id) == Some(kind)
                && field.feature(at).0.get(place.anchor)? != 0.0
            {
                return Ok(Some((
                    std::cell::Ref::map(fields, |fields| &fields[index]),
                    at,
                )));
            }
        }
    }
    Ok(None)
}
pub fn realized<S: RealizationState, Schedule>(
    state: &S,
    entry: &Entry<S, Schedule>,
    place: &Place,
) -> io::Result<bool> {
    if entry.id == Kind::Door || state.physical().is_none() {
        return Ok(true);
    }
    let grown = grown_by(state, entry.id, place)?;
    if let Some((field, rule)) = &grown {
        if magic_place(state, field, *rule, place)? {
            return Ok(true);
        }
    }
    if grown.is_none() && gate(state, entry.id, place)? {
        return Ok(true);
    }
    Ok(
        matches!(entry.group, Group::Relief | Group::Water | Group::Sea)
            && entry
                .roles
                .visibility
                .cultural
                .value()
                .map(|f| f(state, place))
                .transpose()?
                .unwrap_or(0.0)
                >= STRONG_TIE,
    )
}
