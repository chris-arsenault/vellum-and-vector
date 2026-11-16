use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    map_records, origins,
    peak_forms::{self, Form, Readings},
    peak_origins,
    peak_ranges::RangeState,
    places, reads, relief_shape, sites,
    state::State,
    values::*,
    visibility,
};
use crate::{
    field::{
        refinement::{network, topology::distance},
        shared::Scalar,
        significance::{measure, PEAK_ISOLATION},
    },
    noise::hash_unit,
    rock::{
        catalogue::CATALOGUE,
        ground::{queries::SurfaceResponse, GroundField},
    },
    scale::MapScale,
};
use std::{io, rc::Rc};

fn claims<S: CatalogueState<Schedule>, Schedule>(state: &S) -> io::Result<Rc<origins::Claims>> {
    let entry = state.catalogue().get(Kind::Peak);
    origins::claims(
        state,
        Kind::Peak,
        entry
            .existence
            .origins
            .value()
            .map_or(&[], |v| v.as_slice()),
        |kind| {
            state
                .catalogue()
                .get(kind)
                .publication
                .moment
                .value()
                .is_some_and(|&moment| origins::reached(state, moment))
        },
    )
}
fn found<S: CatalogueState<Schedule>, Schedule>(state: &S) -> io::Result<Vec<Place>> {
    Ok(origins::places(Kind::Peak, claims(state)?.as_ref()))
}
fn is_a<S: CatalogueState<Schedule>, Schedule>(state: &S, cell: usize) -> io::Result<bool> {
    Ok(claims(state)?.contains(cell))
}
fn rise(state: &impl State, place: &Place) -> io::Result<f64> {
    peak_origins::metres(state, place.anchor)
}
fn foot(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(state
        .field()?
        .scale
        .supported(rise(state, place)? * 20.0, 2.0))
}
fn magnitude(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(visibility::sized(
        rise(state, place)?,
        measure(&state.field()?.scale, 0.00025, 1, 0.5)?,
    ))
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    let field = state.field()?;
    visibility::stands_out(
        state,
        place,
        field
            .scale
            .cells(2.0)
            .max(reads::height(field, place.anchor)? * 20.0),
        |cell| reads::height(field, cell),
    )
}
fn isolation(state: &impl State, place: &Place) -> io::Result<f64> {
    let field = state.field()?;
    let height = field.ground().view(GroundField::Elevation);
    let top = height.get(place.anchor)?;
    let reach = measure(&field.scale, PEAK_ISOLATION, 1, 1.0)?;
    let higher = sites::nearest_where(&field.mesh, state.spatial(), place.anchor, reach, |cell| {
        Ok(height.get(cell)? > top)
    })?;
    let d = higher.map_or(reach, |cell| distance(&field.mesh, place.anchor, cell));
    Ok(d / (d + foot(state, place)?))
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, foot(state, place)?)
}
fn choose_form(state: &impl State, cell: usize) -> io::Result<Form> {
    let field = state.field()?;
    let unit = |value: f64| value.clamp(0.0, 1.0);
    Ok(peak_forms::choose(
        Readings {
            hardness: reads::rock(field, cell, SurfaceResponse::Hardness)?,
            fracture: reads::rock(field, cell, SurfaceResponse::Openness)?,
            ice: unit(
                field.shared.scalar(Scalar::IceThickness).get(cell)?
                    / measure(&field.scale, 0.000025, 1, 0.5)?,
            ),
            cold: unit(-reads::celsius(field, cell)? / 15.0),
            wet: unit(field.shared.scalar(Scalar::Moisture).get(cell)? / 1000.0),
            steep: unit(field.shared.scalar(Scalar::Slope).get(cell)? / 0.3),
            bedded: CATALOGUE[reads::rock_kind(field, cell)?].facts.bedding,
        },
        hash_unit(0x7021, cell as f64, 0.0),
    ))
}
fn form_in(state: &impl State, place: &Place) -> io::Result<Form> {
    let id = state.varieties().get_or_choose(&place.id, || {
        Ok(choose_form(state, place.anchor)?.id().into())
    })?;
    Form::ALL
        .into_iter()
        .find(|form| form.id() == id)
        .ok_or_else(|| io::Error::other(format!("Unknown peak form: {id}")))
}
fn face(state: &impl State, cell: usize) -> io::Result<f64> {
    let ring = relief_shape::ring_heights(state, cell, state.field()?.scale.cells(2.0))?;
    let mut low = 0;
    for (at, &height) in ring.iter().enumerate() {
        if height.is_finite() && height < ring[low] {
            low = at;
        }
    }
    Ok(low as f64 * std::f64::consts::PI / 8.0
        + (hash_unit(0x7022, cell as f64, 0.0) - 0.5) * std::f64::consts::PI / 2.0)
}
struct Formed {
    cell: usize,
    shape: peak_forms::Shape,
}
fn formed(state: &impl State, place: &Place) -> io::Result<Rc<Vec<Formed>>> {
    state
        .held()
        .get(&format!("peak:form:{}", place.anchor), || {
            let field = state.field()?;
            let mesh = &field.mesh;
            let form = form_in(state, place)?;
            let face = face(state, place.anchor)?;
            let reach = field.scale.supported(0.8 * foot(state, place)?, 2.2);
            let [x, y] = mesh.position(place.anchor);
            let mut formed = Vec::new();
            for cell in sites::within(mesh, place.anchor, reach) {
                if field.water().column.kind.get(cell)? != 0 || reads::has_channel(field, cell)? {
                    continue;
                }
                let [cx, cy] = mesh.position(cell);
                let dx = mesh.delta_x(cx - x);
                let dy = cy - y;
                formed.push(Formed {
                    cell,
                    shape: peak_forms::shape(form, dx.hypot(dy) / reach, dy.atan2(dx), face),
                });
            }
            Ok(formed)
        })
}
fn shaped_ground(state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    let scale = &state.field()?.scale;
    let size = measure(scale, 0.000375, 1, 0.5)?
        .min(0.25 * rise(state, place)? + measure(scale, 0.00002, 1, 0.5)?);
    let mut changes = Vec::new();
    for cell in formed(state, place)?.iter() {
        for (band, value) in [
            (GroundField::Elevation, cell.shape.ground),
            (GroundField::SedimentThickness, cell.shape.debris),
        ] {
            if value != 0.0 {
                changes.push(FieldChange::Physical(PhysicalChange {
                    cell: cell.cell,
                    band: PhysicalBand::Ground(band),
                    change: Change::Add(MapScale::native(value * size)),
                }));
            }
        }
    }
    Ok(changes)
}
fn raw_rock(state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    let bare = formed(state, place)?
        .iter()
        .filter(|cell| cell.shape.bare)
        .map(|cell| cell.cell)
        .collect::<Vec<_>>();
    let mut changes = relief_shape::bare(&bare);
    changes.extend(relief_shape::thin_soil(state, &bare)?);
    Ok(changes)
}
fn counterpart<S: CatalogueState<Schedule>, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    let rise = peak_origins::rise(state)?;
    let mut best = None;
    for cell in sites::within(&state.field()?.mesh, carried.cell, state.parent_cell_span()) {
        if is_a(state, cell)?
            && match best {
                None => true,
                Some(best) => rise.rise.get(cell)? > rise.rise.get(best)?,
            }
        {
            best = Some(cell);
        }
    }
    Ok(best)
}
fn across<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> AcrossMaps<S, Schedule> {
    AcrossMaps { statement:Must::Value("A captured peak stays a drainage divide and its name follows the greatest claimed top within its parent's cell; its form is the child's own.".into()),stands_on:Slot::Unwritten,carry:Slot::Value(Rc::new(carry_rules::where_it_lands)),realize:Slot::NotApplicable("Drainage cost creates the divide, then relief and the top's own form develop."),counterpart:Slot::Value(Rc::new(counterpart)),unrealized:Slot::Value(Rc::new(|state,carried| Ok(carry_rules::moves_to(counterpart(state,carried)?)))),settle:Slot::NotApplicable("A round's water does not relocate the peak."),schedule:Slot::NotApplicable("Its drainage cost supplies the influence needed by refinement.") }
}
fn drainage<S: CatalogueState<Schedule>, Schedule>(
    state: &S,
    place: &Place,
) -> io::Result<Vec<Cost>> {
    let field = state.field()?;
    let captured = place
        .feature
        .as_ref()
        .and_then(|f| f.attributes.get("prominence"))
        .filter(|v| !v.is_null())
        .and_then(|v| v.as_f64())
        .unwrap_or(measure(&field.scale, 0.000075, 1, 0.5)?);
    let reach = (captured / measure(&field.scale, 0.00025, 1, 0.5)?).clamp(0.25, 1.0)
        * state.parent_cell_span();
    Ok(network::repulsion(&field.mesh, place.anchor, reach)
        .into_iter()
        .map(|(cell, factor)| Cost { cell, factor })
        .collect())
}
fn visible<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Visibility<S> {
    Visibility { statement:Must::Value("Prominence, local height, isolation and nearby people give a peak its weight; crowns and captured names carry their own importance.".into()),magnitude:Slot::Value(Rc::new(magnitude)),local_conditions:Slot::Value(Rc::new(local)),isolation:Slot::Value(Rc::new(isolation)),cultural:Slot::Value(Rc::new(cultural)),importance:Must::Value(Rc::new(|state,place| {
        let claims=claims(state)?; let origin=claims.get(place.anchor).map_or("high",|claim| claim.origin.as_str());
        let origin_weight=match origin { "crown"=>0.85,"carried"=>0.7,_=>0.0 };
        Ok((0.35*magnitude(state,place)?+0.45*local(state,place)?+0.2*isolation(state,place)?).max(cultural(state,place)?).max(origin_weight))
    })) }
}
fn roles<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Roles<S> {
    Roles { true_size:super::true_sizes::summit(|state: &S,place: &Place| rise(state,place)),variety:Slot::Value(Variety { statement:"Rock, ice and weather weigh each form; chance selects among all six.".into(),of:Rc::new(|state,place| Ok(choose_form(state,place.anchor)?.id().into())) }),appearance:Slot::Unwritten,account:super::true_sizes::account(Kind::Peak),
        fields:Fields { statement:Must::Value("Rock, ice and weather shape horns, crags, avalanche scars, domes, shattered slopes and tables; bare rock holds thin soil.".into()),terrain:Slot::Value(Rc::new(shaped_ground)),water:Slot::NotApplicable("Ordinary drainage sheds water down its slopes."),climate:Slot::NotApplicable("Climate reads the resulting elevation."),cover:Slot::Value(Rc::new(raw_rock)),magic:Slot::NotApplicable("A peak is not a magic source or carrier.") },
        movement:Movement { statement:Must::Value("Roads pay ordinary slope costs; captured prominence determines the massif the refined drainage network runs around.".into()),roads:Slot::NotApplicable("Road grade reads the slopes."),boats:Slot::NotApplicable("No boat reaches a peak."),drainage:Slot::Value(Rc::new(drainage)),magic:Slot::NotApplicable("A peak neither carries nor blocks magic."),links:Slot::NotApplicable("A peak joins no fixed pair of cells."),crosses:Slot::NotApplicable("A peak supplies no crossing.") },
        others:Others { statement:Must::Value("A peak cannot be a pass; passes lie on its shoulders and nearby towns may name it or take its name.".into()),needs:Slot::NotApplicable("A peak needs no other place to stand."),excludes:Slot::Value(vec![Relation { kind:Kind::Pass,holds:Rc::new(|_,a,b| Ok(a.anchor==b.anchor)) }]),contains:Slot::NotApplicable("A peak is a point."),pairs_with:Slot::Value(vec![cover_shared::near(Kind::Pass,4.0)]) },
        people:People { statement:Must::Value("A peak is a holy height and landmark; steep iced tops shed avalanches.".into()),offers:Slot::Value(Rc::new(|state,place| Ok([(Benefit::Sanctity,magnitude(state,place)?)].into_iter().collect()))),threatens:Slot::Value(Rc::new(|state: &S,place| { let field=state.field()?; Ok(if field.shared.scalar(Scalar::Slope).get(place.anchor)?>0.15 && field.shared.scalar(Scalar::IceThickness).get(place.anchor)?>measure(&field.scale,0.00000025,1,0.5)? { vec![Hazard { hazard:"avalanche".into(),reach:foot(state,place)?/2.0,severity:0.5 }] } else { Vec::new() }) })) },
        time:ThroughTime { statement:Must::Value("Erosion can lower a named top without erasing its recorded identity.".into()),fate:Slot::Value(Rc::new(|_,_| Ok(Fate::Persists))) },visibility:visible(),
        naming:Naming { statement:Must::Value("Nearest people name the peak for its form; towns at its foot may borrow that name.".into()),named_by:Slot::Value(Rc::new(places::naming_culture_near)),takes_name_from:Slot::NotApplicable("Peaks give names rather than take them."),lends_name_to:Slot::Value(vec![cover_shared::near(Kind::Settlement,6.0)]),term:Slot::Value(Rc::new(|state,place| Ok(NameTerm { kind:NameKind::Landform,subkind:Some("peak".into()),term:Some(form_in(state,place)?.term().into()) }))) },
    }
}
pub fn entry<S: RangeState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
) -> Entry<S, Schedule> {
    Entry { id:Kind::Peak,group:Group::Relief,name:"Peak".into(),recognition:Recognition { distinct:Must::Value("A top known as a range crown, a dominant or isolated summit, a sea mark, a pass's horn, a town's mountain or an inherited named peak.".into()),is_a:Must::Value(Rc::new(is_a)),landform:Slot::Value(LandformMark { code:6,yields_to:vec![17] }) },existence:Existence { origins:Slot::Value(peak_origins::origins()),statement:Must::Value("Physical and cultural origins claim known peaks in order; most unnamed tops remain latent.".into()),way:Must::Value(ExistenceWay::Emerges),requires:Slot::NotApplicable("Recognition reads the terrain and its origin claims."),suitability:Slot::NotApplicable("Origins choose which existing tops are known."),places:Must::Value(Rc::new(found)) },publication:Publication { statement:Must::Value("Publish prominence, origin and chosen form; town-named world peaks arrive after settled ground and receive no additional terrain shaping.".into()),moment:Must::Value(Moment::Geography),record:Must::Value(Rc::new(|state: &S,place: &Place| { let mut attributes=crate::features::records::Attributes::new(); attributes.insert("prominence".into(),rise(state,place)?.into()); map_records::site(state,place,"peak","geology","Peak",attributes) })) },across_maps:across(),event:None,roles:roles() }
}
