//! Regional policy supplies local exposure; feature owners supply each process occurrence.
use crate::{
    atlas::features::{invoke, work_span, Catalogue, Context, Policy},
    field::refinement::people::DEVELOPMENT_EXPOSURE,
    parameters::Values,
    recipe::Sequence,
    sequence::SequenceNode,
};
use std::io;

// Arconis: docs/architecture/subsystems.arconis#item=rg_develop — lists the material development steps: erosion, ice, sediment, coast.
const DEVELOPMENT: &[&str] = &[
    "material.relaxation",
    "material.hillslopes",
    "material.margins",
    "ice.model",
    "epoch.sculpting",
    "ice.meltwater",
    "water.routing",
    "water.groundwater",
    "epoch.incision",
    "epoch.after-incision.hillslopes",
    "water.routing",
    "epoch.sediment",
    "epoch.coasts",
    "epoch.ice-load",
];
fn invocation(
    process: &str,
    occurrence: &str,
    parameters: Values,
) -> crate::sequence::SequenceNode<crate::recipe::Invocation, Values> {
    let mut node = invoke(process, parameters);
    if !occurrence.is_empty() {
        if let SequenceNode::Process { id, .. } = &mut node {
            *id = format!("{occurrence}/{id}");
        }
    }
    node
}
// Arconis: docs/architecture/subsystems.arconis#item=rg_refresh — refreshes climate, water and media reads for the child map.
fn refresh(catalogue: &Catalogue, context: &Context<'_>, occurrence: &str) -> io::Result<Sequence> {
    let mut body = Vec::new();
    for slot in ["climate.ocean", "climate.circulation"] {
        body.extend(catalogue.compose(slot, occurrence, context, &work_span(0.0))?);
    }
    body.push(invocation("refinement.media", occurrence, Values::new()));
    for slot in [
        "present.climate-forcing",
        "climate.atmosphere",
        "water.current",
    ] {
        body.extend(catalogue.compose(slot, occurrence, context, &work_span(0.0))?);
    }
    Ok(body)
}
// Arconis: docs/architecture/subsystems.arconis#item=rg_publish — composes the regional sequence ending in an independent child map.
pub fn sequence(catalogue: &Catalogue, context: &Context<'_>) -> io::Result<Sequence> {
    rounds(catalogue, context, false)
}
/// A city round's own steps after its people pass: growth and walls, the hot spots' towns
/// founded and advanced by a few town development rounds, and the prominent places they built.
fn city_round(occurrence: &str, round: usize) -> Sequence {
    let mut body = vec![
        invocation(
            "refinement.city-growth",
            occurrence,
            Values::from_iter([("round".into(), round.into())]),
        ),
        invocation("refinement.city-spots", occurrence, Values::new()),
    ];
    // The town steps' occurrences stay outside `town/`, so they make no town previews.
    for town_round in 0..super::city::spots::TOWN_ROUNDS {
        let path = format!("{occurrence}/hot-spot-town-{town_round}");
        for id in crate::processes::town::operation_ids() {
            body.push(invocation(id, &path, Values::new()));
        }
    }
    body.push(invocation(
        "refinement.city-places",
        occurrence,
        Values::new(),
    ));
    body
}
/// A city map develops as a region does, with its city steps after each round's people pass:
/// growth, walls and the hot spots' towns read where people, ways and centres stand, and the
/// next round's refinement reads what they changed.
pub fn city(catalogue: &Catalogue, context: &Context<'_>) -> io::Result<Sequence> {
    rounds(catalogue, context, true)
}
fn rounds(catalogue: &Catalogue, context: &Context<'_>, city: bool) -> io::Result<Sequence> {
    let context = Context {
        policy: Policy::Regional,
        ..context.clone()
    };
    let society = ["built.layout", "human.cultures", "human.politics"]
        .iter()
        .any(|id| context.enabled(id));
    let group = |slot, occurrence: &str, span| {
        catalogue.compose(slot, occurrence, &context, &work_span(span))
    };
    let span = 1.0 / DEVELOPMENT_EXPOSURE.len() as f64;
    let mut body = [
        "atlas.initialize",
        "refinement.begin",
        "refinement.clear-products",
        "refinement.context",
        "refinement.relief",
    ]
    .iter()
    .map(|id| invoke(id, Values::new()))
    .collect::<Sequence>();
    body.extend(group("terrain.refinement", "detail", span)?);
    body.extend(group("initialize.ecology", "detail", span)?);
    for round in 1..=DEVELOPMENT_EXPOSURE.len() {
        let occurrence = format!("round-{round}");
        body.push(invocation(
            "refinement.round",
            &occurrence,
            Values::from_iter([("round".into(), round.into())]),
        ));
        body.extend(refresh(
            catalogue,
            &context,
            &format!("{occurrence}/before"),
        )?);
        body.extend(group(
            "water.runoff",
            &format!("{occurrence}/supply"),
            span,
        )?);
        body.extend(group(
            if round == 1 {
                "water.initialize"
            } else {
                "water.routing"
            },
            &format!("{occurrence}/courses"),
            span,
        )?);
        if round == 1 {
            body.extend(group("epoch.material-forcing", &occurrence, span)?);
        }
        for (position, slot) in DEVELOPMENT.iter().enumerate() {
            body.extend(group(slot, &format!("{occurrence}/{position}"), span)?);
        }
        body.extend(refresh(
            catalogue,
            &context,
            &format!("{occurrence}/after"),
        )?);
        if round == 1 {
            body.extend(group("ice.flow", &format!("{occurrence}/carriers"), 0.0)?);
            body.extend(group("epoch.post-glacial-forcing", &occurrence, span)?);
        }
        body.extend(group("epoch.ecology-evolve", &occurrence, span)?);
        body.extend(group("epoch.ecology-burial", &occurrence, span)?);
        body.push(invocation(
            "refinement.place-effects",
            &occurrence,
            Values::from_iter([("people".into(), society.into())]),
        ));
        if city {
            body.extend(city_round(&occurrence, round));
        }
        body.extend(group(
            "water.routing",
            &format!("{occurrence}/final-courses"),
            span,
        )?);
    }
    if city {
        body.push(invoke("refinement.city-plan", Values::new()));
    }
    body.extend(refresh(catalogue, &context, "final")?);
    for slot in [
        "ice.flow",
        "present.glacial-landforms",
        "present.river-geometry",
        "present.floodplains",
        "present.deltas",
        "present.landforms",
        "present.ecology",
    ] {
        body.extend(group(slot, "final", 0.0)?);
    }
    body.push(invoke("refinement.refresh", Values::new()));
    body.extend(group("present.classify", "final", span)?);
    body.extend(
        [
            "atlas.project",
            "atlas.features",
            "atlas.magic-places",
            "refinement.identity",
        ]
        .iter()
        .map(|id| invoke(id, Values::new())),
    );
    if society {
        body.push(invoke("refinement.places", Values::new()));
        body.push(invoke("human.population-present", Values::new()));
    }
    body.push(invoke("atlas.names", Values::new()));
    Ok(body)
}
/// A real-scale map (ADR 0016) develops its land with the same processes as a region: the
/// development rounds cut its valleys and streams at the fine span from the captured
/// surface. Real-scale steps (settlement layout and the like) follow the regional body.
pub fn real_scale(
    catalogue: &Catalogue,
    context: &Context<'_>,
    town: Sequence,
) -> io::Result<Sequence> {
    let mut body = sequence(catalogue, context)?;
    // Once the map's rivers are drawn at their real width, pools form on them and bare rock
    // shows.
    let drawn = body
        .iter()
        .position(|node| matches!(node, SequenceNode::Process { id, .. } if id == "atlas.features"))
        .ok_or_else(|| io::Error::other("The regional sequence draws the map's features"))?;
    for (at, id) in ["real-scale.pools", "real-scale.rock"].iter().enumerate() {
        body.insert(drawn + 1 + at, invoke(id, Values::new()));
    }
    // Caves open in the map's own rock before the closing names step, so they are named.
    let names = body.len() - 1;
    body.insert(names, invoke("refinement.caves", Values::new()));
    body.extend(town);
    // Trails join the places no way reaches to the ways, streets included; every way then
    // crosses water at a ford or bridge; plants and stones stand clear of all of it.
    for id in [
        "real-scale.trails",
        "real-scale.crossings",
        "real-scale.cover",
    ] {
        body.push(invoke(id, Values::new()));
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atlas::features::{Selected, Selection};

    #[test]
    fn every_city_round_runs_growth_then_its_hot_spot_towns_then_records_their_places() {
        let catalogue = Catalogue::default();
        let selection = Selection::from([(
            "built.layout".into(),
            Selected {
                enabled: true,
                ..Default::default()
            },
        )]);
        let context = Context {
            selection: &selection,
            policy: Policy::Regional,
            refinement: true,
            landmarks_apply: false,
            standalone_magic: false,
            initial: false,
            material: false,
            process: None,
        };
        let ids: Vec<String> = city(&catalogue, &context)
            .unwrap()
            .iter()
            .filter_map(|node| match node {
                SequenceNode::Process { id, .. } => Some(id.clone()),
                _ => None,
            })
            .collect();
        let at = |id: &str| ids.iter().position(|i| i == id).unwrap();
        for round in 1..=DEVELOPMENT_EXPOSURE.len() {
            let r = format!("round-{round}");
            let growth = at(&format!("{r}/refinement.city-growth"));
            let spots = at(&format!("{r}/refinement.city-spots"));
            let built = at(&format!("{r}/hot-spot-town-0/town.construction"));
            let places = at(&format!("{r}/refinement.city-places"));
            assert!(growth < spots && spots < built && built < places);
            // The next round's refinement reads what the round's towns did.
            if round < DEVELOPMENT_EXPOSURE.len() {
                assert!(places < at(&format!("round-{}/refinement.round", round + 1)));
            }
        }
        // Districts are cut once, after the last round's places.
        let last = DEVELOPMENT_EXPOSURE.len();
        assert!(at(&format!("round-{last}/refinement.city-places")) < at("refinement.city-plan"));
        // No town step runs under `town/`, so a city map makes no town previews.
        assert!(ids.iter().all(|id| !id.starts_with("town/")));
    }
}
