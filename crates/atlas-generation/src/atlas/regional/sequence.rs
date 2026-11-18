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
        body.extend(group(
            "water.routing",
            &format!("{occurrence}/final-courses"),
            span,
        )?);
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
