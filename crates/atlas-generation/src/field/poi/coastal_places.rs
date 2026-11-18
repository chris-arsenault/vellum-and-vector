use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    map_records, places, reads, records, sea_shared as sea,
    shore_form::{self, Form},
    sites,
    state::State,
    values::*,
    visibility,
};
use crate::{
    field::{shared::Scalar, significance::measure},
    rock::{
        catalogue::{CATALOGUE, STRATA},
        ground::{queries::SurfaceResponse, GroundField},
    },
    scale::MapScale,
};
use std::{io, rc::Rc};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Coast {
    Bay,
    Headland,
    Strait,
}
impl Coast {
    pub const ALL: [Self; 3] = [Self::Bay, Self::Headland, Self::Strait];
    fn kind(self) -> Kind {
        match self {
            Self::Bay => Kind::Bay,
            Self::Headland => Kind::Headland,
            Self::Strait => Kind::Strait,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Bay => "Bay",
            Self::Headland => "Headland",
            Self::Strait => "Strait",
        }
    }
    fn form(self) -> Form {
        match self {
            Self::Bay => Form::Bay,
            Self::Headland => Form::Headland,
            Self::Strait => Form::Strait,
        }
    }
    fn is_a(self, state: &impl State, cell: usize) -> io::Result<bool> {
        Ok(shore_form::at(state, cell)?.form == self.form())
    }
    fn found(self, state: &impl State) -> io::Result<Vec<Place>> {
        Ok(places::region_places(
            state,
            self.kind(),
            |cell| self.is_a(state, cell),
            |cell| wrap(state, cell),
        )?
        .as_ref()
        .clone())
    }
    fn magnitude(self, state: &impl State, place: &Place) -> io::Result<f64> {
        Ok(visibility::sized(
            sea::area(state, place)?,
            measure(
                &state.field()?.scale,
                if self == Self::Bay {
                    0.0000625
                } else {
                    0.00003125
                },
                2,
                1.0,
            )?,
        ))
    }
    fn isolation(self, state: &impl State, place: &Place) -> io::Result<f64> {
        visibility::alone_among(
            state,
            place,
            &self.found(state)?,
            around(state)? * if self == Self::Strait { 4.0 } else { 1.0 },
        )
    }
    fn cultural(self, state: &impl State, place: &Place) -> io::Result<f64> {
        visibility::attachment(
            state,
            place,
            around(state)? * if self == Self::Strait { 2.0 } else { 1.0 },
        )
    }
}
fn wrap(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(shore_form::at(state, cell)?.wrap)
}
fn around(state: &impl State) -> io::Result<f64> {
    sea::near(state, 0.01)
}
fn reach(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(state
        .field()?
        .scale
        .cells(2.0)
        .max(sea::extent(state, place)?))
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::stands_out(
        state,
        place,
        around(state)?.max(2.0 * sea::extent(state, place)?),
        |cell| wrap(state, cell),
    )
}
fn current(state: &impl State, cell: usize) -> io::Result<f64> {
    state
        .field()?
        .shared
        .scalar(Scalar::OceanCurrentStrength)
        .get(cell)
}
fn emerged(state: &impl State) -> io::Result<f64> {
    Ok(state.field()?.water().effective_sea_level
        + MapScale::native(measure(&state.field()?.scale, 0.00000025, 1, 0.5)?))
}
fn tip_exposure(state: &impl State, place: &Place) -> io::Result<f64> {
    let mut worst = 0.0f64;
    for cell in sea::sea_facing(state, &place.cells)? {
        worst = worst.max(sea::exposure_beside(state, cell)?);
    }
    Ok(worst)
}
fn terrain(coast: Coast, state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    match coast {
        Coast::Bay => sea::held_under(
            state,
            &place.cells,
            measure(&state.field()?.scale, 0.00000025, 1, 0.5)?,
        ),
        Coast::Headland => {
            let value = emerged(state)?;
            Ok(sea::sea_facing(state, &place.cells)?
                .into_iter()
                .map(|cell| {
                    FieldChange::Physical(PhysicalChange {
                        cell,
                        band: PhysicalBand::Ground(GroundField::Elevation),
                        change: Change::AtLeast(value),
                    })
                })
                .collect())
        }
        Coast::Strait => {
            let mut cells = Vec::new();
            for &cell in &place.cells {
                if current(state, cell)? >= 300.0 {
                    cells.push(cell);
                }
            }
            sea::held_under(
                state,
                &cells,
                measure(&state.field()?.scale, 0.0000005, 1, 0.5)?,
            )
        }
    }
}
fn cover(coast: Coast, state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    let mut changes = Vec::new();
    if coast == Coast::Bay {
        let field = state.field()?;
        let height = measure(&field.scale, 0.0000005, 1, 0.5)?;
        for cell in sea::shore(state, place)? {
            if reads::height(field, cell)? <= height
                && field.shared.scalar(Scalar::Slope).get(cell)? <= 0.01
            {
                changes.push(FieldChange::Physical(PhysicalChange {
                    cell,
                    band: PhysicalBand::Scalar(Scalar::WetlandCover),
                    change: Change::AtLeast(0.3),
                }));
            }
        }
    } else if coast == Coast::Headland {
        for cell in sea::sea_facing(state, &place.cells)? {
            changes.push(FieldChange::Physical(PhysicalChange {
                cell,
                band: PhysicalBand::Scalar(Scalar::TreeCover),
                change: Change::AtMost(1.0 - sea::exposure_beside(state, cell)?),
            }));
        }
    }
    Ok(changes)
}
fn realize<S: CatalogueState<Schedule>, Schedule>(
    coast: Coast,
    state: &S,
    carried: &Carried,
) -> io::Result<Vec<FieldChange>> {
    let field = state.field()?;
    let cells = if coast == Coast::Bay {
        carried.cells.clone()
    } else {
        sites::within(&field.mesh, carried.cell, state.parent_cell_span() / 2.0)
    };
    let mut selected = Vec::new();
    for cell in cells {
        let kind = field.water().column.kind.get(cell)?;
        if (coast == Coast::Headland && kind == 0) || (coast != Coast::Headland && kind == 1) {
            selected.push(cell);
        }
    }
    if coast != Coast::Headland {
        return sea::held_under(
            state,
            &selected,
            measure(
                &field.scale,
                if coast == Coast::Bay {
                    0.00000025
                } else {
                    0.0000005
                },
                1,
                0.5,
            )?,
        );
    }
    let mut changes = selected
        .into_iter()
        .map(|cell| {
            FieldChange::Physical(PhysicalChange {
                cell,
                band: PhysicalBand::Ground(GroundField::RockResistance),
                change: Change::AtLeast(2.0 * CATALOGUE[STRATA].facts.resistance),
            })
        })
        .collect::<Vec<_>>();
    if field.water().column.kind.get(carried.cell)? == 0 {
        changes.push(FieldChange::Physical(PhysicalChange {
            cell: carried.cell,
            band: PhysicalBand::Ground(GroundField::Elevation),
            change: Change::AtLeast(emerged(state)?),
        }));
    }
    Ok(changes)
}
fn counterpart<S: CatalogueState<Schedule>, Schedule>(
    coast: Coast,
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 2.0, |cell| {
        coast.is_a(state, cell)
    })
}
fn fields<S: State + 'static>(coast: Coast) -> Fields<S> {
    Fields { statement: Must::Value("Bays retain submerged beds and marsh shores; points stand above water with pruned canopy; currents scour strait sills.".into()), terrain: Slot::Value(Rc::new(move |state, place| terrain(coast, state, place))),
        water: Slot::NotApplicable("The ocean owner writes current and wave exposure."), climate: Slot::NotApplicable("The ordinary coastal heat, fog and ice processes read this coast."),
        cover: if coast == Coast::Strait { Slot::NotApplicable("Open salt water has no canopy; fauna reads productivity.") } else { Slot::Value(Rc::new(move |state, place| cover(coast, state, place))) }, magic: Slot::NotApplicable("Pressure rays read the geometry and existing carriers own their stock."), }
}
fn nearby_costs(
    state: &impl State,
    place: &Place,
    select: impl Fn(u8) -> bool,
    factor: impl Fn(usize) -> io::Result<f64>,
) -> io::Result<Vec<Cost>> {
    let field = state.field()?;
    let mut costs = Vec::new();
    for cell in sites::within(&field.mesh, place.anchor, reach(state, place)?) {
        if select(field.water().column.kind.get(cell)?) {
            costs.push(Cost {
                cell,
                factor: factor(cell)?,
            });
        }
    }
    Ok(costs)
}
fn movement<S: State + 'static>(coast: Coast) -> Movement<S> {
    let roads = match coast {
        Coast::Bay => Slot::NotApplicable("Shore roads follow ordinary grade."),
        Coast::Headland => Slot::Value(Rc::new(|state: &S, place: &Place| {
            carry_rules::cost_near(state, place, 1.4, 0.0)
        }) as OnPlace<S, Vec<Cost>>),
        Coast::Strait => Slot::Value(Rc::new(|state: &S, place: &Place| {
            nearby_costs(state, place, |kind| kind != 1, |_| Ok(0.85))
        }) as OnPlace<S, Vec<Cost>>),
    };
    let boats: OnPlace<S, Vec<Cost>> = Rc::new(move |state, place| match coast {
        Coast::Bay => carry_rules::cost_near(state, place, 0.8, 0.0),
        Coast::Headland => nearby_costs(
            state,
            place,
            |kind| kind == 1,
            |cell| Ok(1.0 + 2.0 * sea::exposure(state, cell)?),
        ),
        Coast::Strait => place
            .cells
            .iter()
            .map(|&cell| {
                Ok(Cost {
                    cell,
                    factor: 1.0 + 1.5 * current(state, cell)? / 1000.0,
                })
            })
            .collect(),
    });
    let drainage = match coast {
        Coast::Bay => Slot::Value(Rc::new(|state: &S, place: &Place| {
            nearby_costs(state, place, |kind| kind == 0, |_| Ok(0.85))
        }) as OnPlace<S, Vec<Cost>>),
        Coast::Headland => Slot::Value(Rc::new(|state: &S, place: &Place| {
            carry_rules::cost_near(state, place, 1.5, 0.0)
        }) as OnPlace<S, Vec<Cost>>),
        Coast::Strait => Slot::NotApplicable("Each shore drains on its own side of the sea."),
    };
    let magic = if coast == Coast::Headland {
        Slot::NotApplicable("Land already stops currents and rays.")
    } else {
        let cost: OnPlace<S, Vec<Cost>> = Rc::new(move |state, place| {
            carry_rules::cost_near(
                state,
                place,
                if coast == Coast::Bay { 1.3 } else { 0.7 },
                0.0,
            )
        });
        Slot::Value([(Carrier::Current, cost)].into_iter().collect())
    };
    Movement { on_foot: None, statement: Must::Value("Shelter, exposed rounding and narrows set boat costs; land routes and drainage respond to the same coast.".into()), roads, boats: Slot::Value(boats), drainage, magic,
        links: Slot::NotApplicable("The coast joins no fixed pair of cells."), crosses: if coast == Coast::Strait { Slot::Value(Rc::new(|_, _| Ok(vec![Barrier::Strait]))) } else { Slot::NotApplicable("This coast opens no crossing.") }, }
}
fn relation<S: State + 'static>(kind: Kind, factor: f64) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(move |state, a, b| places::within(state, a, b, factor * around(state)?)),
    }
}
fn others<S: State + 'static>(coast: Coast) -> Others<S> {
    let (excludes, contains, pairs) = match coast {
        Coast::Headland => (
            vec![Relation {
                kind: Kind::Harbour,
                holds: Rc::new(|_: &S, a: &Place, b: &Place| Ok(a.anchor == b.anchor))
                    as RelationRule<S>,
            }],
            Slot::Value(cover_shared::holds(&[Kind::Peak, Kind::Shrine, Kind::Ruin])),
            vec![
                relation(Kind::Bay, 1.0),
                relation(Kind::Harbour, 1.0),
                relation(Kind::RogueWaveImpact, 2.0),
            ],
        ),
        _ => {
            let excludes = [
                if coast == Coast::Bay {
                    Kind::Strait
                } else {
                    Kind::Bay
                },
                Kind::Fjord,
            ]
            .into_iter()
            .map(|kind| Relation {
                kind,
                holds: Rc::new(|_: &S, a: &Place, b: &Place| Ok(b.cells.contains(&a.anchor)))
                    as RelationRule<S>,
            })
            .collect();
            let contains = if coast == Coast::Bay {
                Slot::Value(cover_shared::holds(&[
                    Kind::RogueWaveImpact,
                    Kind::UpwellingFront,
                ]))
            } else {
                Slot::NotApplicable("Nothing stands in a passage's running water.")
            };
            let kinds = if coast == Coast::Bay {
                vec![
                    Kind::Harbour,
                    Kind::Headland,
                    Kind::RiverMouth,
                    Kind::Wetland,
                ]
            } else {
                vec![Kind::Harbour, Kind::Settlement, Kind::Headland]
            };
            (
                excludes,
                contains,
                kinds.into_iter().map(|kind| relation(kind, 1.0)).collect(),
            )
        }
    };
    Others { statement: Must::Value("Bays, points and passages relate to their shore settlements, harbours and receiving rivers.".into()), needs: Slot::NotApplicable("Recognition reads the required shores."), excludes: Slot::Value(excludes), contains, pairs_with: Slot::Value(pairs) }
}
fn offers(coast: Coast, state: &impl State, place: &Place) -> io::Result<Benefits> {
    let wrap = wrap(state, place.anchor)?;
    Ok(match coast {
        Coast::Bay => {
            let salt = reads::celsius(state.field()?, place.anchor)? >= 15.0
                && sea::depth(state, place.anchor)?
                    <= measure(&state.field()?.scale, 0.0000025, 1, 0.5)?;
            [
                (Benefit::Trade, wrap),
                (Benefit::Food, sea::fauna(state, place.anchor)?),
                (Benefit::Materials, if salt { 0.5 } else { 0.0 }),
            ]
            .into_iter()
            .collect()
        }
        Coast::Headland => [
            (Benefit::Defence, wrap),
            (Benefit::Sanctity, coast.magnitude(state, place)? / 2.0),
        ]
        .into_iter()
        .collect(),
        Coast::Strait => [
            (Benefit::Trade, wrap),
            (Benefit::Defence, wrap),
            (Benefit::Food, sea::fauna(state, place.anchor)?),
        ]
        .into_iter()
        .collect(),
    })
}
fn threatens(coast: Coast, state: &impl State, place: &Place) -> io::Result<Vec<Hazard>> {
    let (hazard, severity) = match coast {
        Coast::Bay => {
            let storm = sea::storm(state, place.anchor)?;
            if storm <= 0.0 {
                return Ok(Vec::new());
            }
            ("storm surge", storm)
        }
        Coast::Headland => ("shipwreck", tip_exposure(state, place)?),
        Coast::Strait => ("tide race", current(state, place.anchor)? / 1000.0),
    };
    Ok(vec![Hazard {
        hazard: hazard.into(),
        severity,
        reach: reach(state, place)?,
    }])
}
fn fate(coast: Coast, state: &impl State, place: &Place) -> io::Result<Fate> {
    let field = state.field()?;
    Ok(match coast {
        Coast::Bay => {
            if sea::depth(state, place.anchor)? <= measure(&field.scale, 0.0000005, 1, 0.5)? {
                Fate::Ends {
                    leaves: Some(Kind::Wetland),
                }
            } else {
                Fate::Persists
            }
        }
        Coast::Headland => {
            let mut forcing = 0.0f64;
            for &cell in &place.cells {
                forcing = forcing.max(
                    field
                        .shared
                        .scalar(Scalar::ExternalCoastalForcingHistory)
                        .get(cell)?,
                );
            }
            if tip_exposure(state, place)? * (1.0 + forcing / 1000.0)
                > reads::rock(field, place.anchor, SurfaceResponse::HardestShare)?
            {
                Fate::Ends { leaves: None }
            } else {
                Fate::Persists
            }
        }
        Coast::Strait => {
            let mut least = f64::INFINITY;
            for &cell in &place.cells {
                least = least.min(sea::depth(state, cell)?);
            }
            if least < measure(&field.scale, 0.0000005, 1, 0.5)? {
                Fate::Ends { leaves: None }
            } else {
                Fate::Persists
            }
        }
    })
}
fn visible<S: State + 'static>(coast: Coast) -> Visibility<S> {
    let (m, l, i) = match coast {
        Coast::Bay => (0.5, 0.3, 0.2),
        Coast::Headland => (0.4, 0.4, 0.2),
        Coast::Strait => (0.3, 0.3, 0.4),
    };
    Visibility {
        statement: Must::Value(
            "Size, wrap against the coast, isolation and shore communities determine the mark."
                .into(),
        ),
        magnitude: Slot::Value(Rc::new(move |state, place| coast.magnitude(state, place))),
        local_conditions: Slot::Value(Rc::new(local)),
        isolation: Slot::Value(Rc::new(move |state, place| coast.isolation(state, place))),
        cultural: Slot::Value(Rc::new(move |state, place| coast.cultural(state, place))),
        importance: Must::Value(Rc::new(move |state, place| {
            Ok((m * coast.magnitude(state, place)?
                + l * local(state, place)?
                + i * coast.isolation(state, place)?)
            .max(coast.cultural(state, place)?))
        })),
    }
}
fn across<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    coast: Coast,
) -> AcrossMaps<S, Schedule> {
    AcrossMaps { statement: Must::Value("Captured coast holds its bed or resistant ground; names follow the finer counterpart and retain the broad parent's place when needed.".into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::Value(Rc::new(move |state, carried| realize(coast, state, carried))), counterpart: Slot::Value(Rc::new(move |state, carried| counterpart(coast, state, carried))),
        unrealized: Slot::Value(Rc::new(move |state, carried| Ok(carry_rules::moves_to(counterpart(coast, state, carried)?)))),
        settle: if coast == Coast::Strait { Slot::NotApplicable("Its held bed does not move with a round's water.") } else { Slot::Value(Rc::new(move |state, carried| {
            let sea = state.field()?.water().column.kind.get(carried.cell)? == 1;
            if sea == (coast == Coast::Bay) { Ok(Unrealized::Keep) } else { Ok(carry_rules::moves_to(counterpart(coast, state, carried)?)) }
        })) }, schedule: Slot::NotApplicable("Held ground supplies refinement without another step."), }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    coast: Coast,
) -> Entry<S, Schedule> {
    Entry { id: coast.kind(), group: Group::Sea, name: coast.name().into(),
        recognition: Recognition { distinct: Must::Value("The smallest resolved shoreline circle identifies one wrapped water opening, a connected land neck or two opposing shores with open water at both ends; fjords retain their own kind.".into()), is_a: Must::Value(Rc::new(move |state, cell| coast.is_a(state, cell))), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("The generated shoreline determines this form without a siting process.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("Recognition reads the water mask."), suitability: Slot::NotApplicable("No process chooses the coastal form."), places: Must::Value(Rc::new(move |state| coast.found(state))) },
        publication: Publication { delivery: Delivery::Landforms, statement: Must::Value("Bays publish weighted outlines; points and straits publish at their most wrapped cell.".into()), moment: Must::Value(Moment::Geography), record: Must::Value(Rc::new(move |state: &S, place: &Place| {
            let mut attributes = crate::features::records::Attributes::new(); attributes.insert("wrap".into(), wrap(state, place.anchor)?.into());
            if coast == Coast::Bay { records::area(state, place, records::Shape { kind: "bay", name: "Bay", layer: "geology", attributes }, Some(&|cell| wrap(state, cell))) }
            else { map_records::site(state, place, coast.kind().as_str(), "geology", coast.name(), attributes) }
        })) }, across_maps: across(coast), event: None,
        roles: Roles { true_size: match coast { Coast::Bay => super::true_sizes::extent(), Coast::Headland => super::true_sizes::sited(&super::true_sizes::HEADLAND), Coast::Strait => super::true_sizes::sited(&super::true_sizes::STRAIT) }, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(coast.kind()), fields: fields(coast), movement: movement(coast), others: others(coast),
            people: People { statement: Must::Value("Sheltered trade, fish and defensible shores coexist with surge, wrecks or tide races.".into()), offers: Slot::Value(Rc::new(move |state, place| offers(coast, state, place))), threatens: Slot::Value(Rc::new(move |state, place| threatens(coast, state, place))) },
            time: ThroughTime { statement: Must::Value("Silt closes bays and passages; waves and forcing wear points according to their rock.".into()), fate: Slot::Value(Rc::new(move |state, place| fate(coast, state, place))) }, visibility: visible(coast),
            naming: Naming { statement: Must::Value("Shore people and communities name the coast, and harbours borrow its names.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: if coast == Coast::Headland { Slot::NotApplicable("Sailors name the point first.") } else { Slot::Value(vec![NameRelation { relation: relation(Kind::Settlement, 1.0), chance: None }]) }, lends_name_to: Slot::Value(if coast == Coast::Headland { vec![relation(Kind::Harbour, 1.0), relation(Kind::Settlement, 1.0)] } else { vec![relation(Kind::Harbour, 1.0)] }), term: Slot::Unwritten },
        },
    }
}
