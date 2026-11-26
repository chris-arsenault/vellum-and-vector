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
/// City guidance contributes to household placement during the society group. Walls and
/// the hot spots' towns read its result before the next refinement round.
pub fn city(catalogue: &Catalogue, context: &Context<'_>) -> io::Result<Sequence> {
    rounds(catalogue, context, true)
}
// Arconis: docs/architecture/subsystems.arconis#item=rg_people — compose the present-ground society owners in each regional development round.
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
    if city {
        body.extend(group("town.initialize", "city-policy", 0.)?);
    }
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
        water_round(&mut body, group, &occurrence, span, round)?;
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
        develop_settlement(city, society, group, span, &mut body, &occurrence)?;
    }
    if city {
        // owner-direction(2026-11-24): City districts partition the developed main settlement after competing processes; ordinary streets and blocks belong to district maps
        body.extend(group("city.partition", "final", 0.)?);
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
    if city {
        body.extend(group("city.publish", "final", 0.)?);
    }
    Ok(body)
}

fn water_round(
    body: &mut Sequence,
    group: impl Fn(&'static str, &str, f64) -> io::Result<Sequence>,
    occurrence: &str,
    span: f64,
    round: usize,
) -> io::Result<()> {
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
        body.extend(group("epoch.material-forcing", occurrence, span)?);
    }
    Ok(())
}

fn develop_settlement(
    city: bool,
    society: bool,
    group: impl Fn(&'static str, &str, f64) -> io::Result<Sequence>,
    span: f64,
    body: &mut Sequence,
    occurrence: &str,
) -> io::Result<()> {
    body.push(invocation(
        "refinement.place-effects",
        occurrence,
        Values::from_iter([("people".into(), society.into())]),
    ));
    if society {
        for id in [
            "human.land.trade",
            "human.land.feed",
            "human.land.gather",
            "human.land.harden",
            "settlement.built-maintenance",
        ] {
            body.push(invocation(id, occurrence, Values::new()));
        }
    }
    if city {
        body.push(invocation(
            "refinement.city-works",
            occurrence,
            Values::new(),
        ));
        // owner-direction(2026-11-24): district programs shape City geography before permanent district boundaries are drawn
        for slot in [
            "city.programs",
            "city.claims",
            "city.invest",
            "city.routes",
            "city.landscape",
        ] {
            body.extend(group(slot, occurrence, 0.)?);
        }
        body.extend(group(
            "city.routes",
            &format!("{occurrence}/crossings"),
            0.,
        )?);
    }
    body.extend(group(
        "water.routing",
        &format!("{occurrence}/final-courses"),
        span,
    )?);
    Ok(())
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
    fn city_resolves_ground_and_crossings_each_round_before_the_final_partition() {
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
            let growth = at(&format!("{r}/human.land.gather"));
            let works = at(&format!("{r}/refinement.city-works"));
            assert!(growth < works);
            let order = [
                "city.programs/town.districts",
                "city.claims/town.land-competition",
                "city.invest/town.collective-investment",
                "city.routes/town.movement",
                "city.landscape/town.construction",
            ]
            .map(|operation| at(&format!("{r}/built.layout/{operation}")));
            assert!(works < order[0] && order.windows(2).all(|p| p[0] < p[1]));
            assert!(
                order[3]
                    < at(&format!(
                        "{r}/crossings/built.layout/city.routes/town.movement"
                    ))
            );
        }
        let order = [
            format!(
                "round-{}/built.layout/city.landscape/town.construction",
                DEVELOPMENT_EXPOSURE.len()
            ),
            "final/built.layout/city.partition/town.districts".into(),
            "final/built.layout/city.publish/town.urban-geography".into(),
        ];
        assert!(order.windows(2).all(|pair| at(&pair[0]) < at(&pair[1])));
        assert_eq!(
            ids.iter()
                .filter(|id| id.ends_with("city.partition/town.districts"))
                .count(),
            1
        );
        assert!(ids.iter().all(|id| !id.contains("hot-spot-town")));
    }
}
