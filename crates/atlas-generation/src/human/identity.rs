//! Detached identity columns retain traditions, exposure order and resistance to adoption.
pub const IDENTITY_SLOTS: usize = 4;
const TRACE: f64 = 1e-6;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub enum Tradition {
    Tongue,
    Faith,
    Custom,
    Allegiance,
    Craft,
}
impl Tradition {
    pub const ALL: [Self; 5] = [
        Self::Tongue,
        Self::Faith,
        Self::Custom,
        Self::Allegiance,
        Self::Craft,
    ];
    pub const SOCIAL: [Self; 4] = [Self::Tongue, Self::Faith, Self::Custom, Self::Allegiance];
}
// Arconis: docs/architecture/subsystems.arconis#item=pp_layers — one entry of the people's identity column.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct IdentityLayer {
    pub people: f64,
    pub hardness: f64,
    pub age: f64,
    pub traditions: [i32; 5],
}
pub type IdentityColumn = Vec<IdentityLayer>;
pub type TraditionChanges = [Option<i32>; 5];
fn join(into: &mut IdentityLayer, from: &IdentityLayer) {
    let people = into.people + from.people;
    if people <= 0.0 {
        return;
    }
    into.hardness = (into.hardness * into.people + from.hardness * from.people) / people;
    into.age = (into.age * into.people + from.age * from.people) / people;
    into.people = people;
}
fn alike(a: &IdentityLayer, b: &IdentityLayer) -> usize {
    Tradition::SOCIAL
        .iter()
        .filter(|&&field| a.traditions[field as usize] == b.traditions[field as usize])
        .count()
}
fn twinned(column: &[IdentityLayer]) -> Option<usize> {
    let mut found = None;
    for a in 0..column.len() {
        for b in a + 1..column.len() {
            if alike(&column[a], &column[b]) < 4 {
                continue;
            }
            let thinner = if column[a].people < column[b].people {
                a
            } else {
                b
            };
            if found.is_none_or(|found: usize| column[thinner].people < column[found].people) {
                found = Some(thinner);
            }
        }
    }
    found
}
fn least(column: &[IdentityLayer]) -> usize {
    (1..column.len()).fold(0, |least, index| {
        if column[index].people < column[least].people {
            index
        } else {
            least
        }
    })
}
fn heir(column: &[IdentityLayer], lost: &IdentityLayer, at: usize) -> usize {
    (1..column.len()).fold(0, |heir, index| {
        let (a, b) = (alike(&column[index], lost), alike(&column[heir], lost));
        if a > b || (a == b && index.abs_diff(at) < heir.abs_diff(at)) {
            index
        } else {
            heir
        }
    })
}
pub fn settle(column: &mut IdentityColumn) {
    column.retain(|layer| layer.people > TRACE);
    while column.len() > IDENTITY_SLOTS {
        let at = twinned(column).unwrap_or_else(|| least(column));
        let lost = column.remove(at);
        let to = heir(column, &lost, at);
        // The heir retains its own age and hardness; only its holding grows.
        column[to].people += lost.people;
    }
}
pub fn rename(column: &mut IdentityColumn, field: Tradition, from: i32, to: i32) {
    let previous = std::mem::take(column);
    for mut layer in previous {
        if layer.traditions[field as usize] == from {
            layer.traditions[field as usize] = to;
        }
        if let Some(held) = column
            .iter_mut()
            .find(|held| held.traditions == layer.traditions)
        {
            join(held, &layer);
        } else {
            column.push(layer);
        }
    }
    settle(column);
}
pub fn arrive(column: &mut IdentityColumn, arriving: &[IdentityLayer]) {
    for layer in arriving.iter().rev().filter(|layer| layer.people > TRACE) {
        if let Some(held) = column
            .iter_mut()
            .find(|held| held.traditions == layer.traditions)
        {
            join(held, layer);
        } else {
            column.insert(0, layer.clone());
        }
    }
    settle(column);
}
fn changed(traditions: [i32; 5], changes: &TraditionChanges) -> [i32; 5] {
    std::array::from_fn(|index| changes[index].unwrap_or(traditions[index]))
}
pub fn overlay(
    column: &mut IdentityColumn,
    changes: &TraditionChanges,
    people: f64,
    hardness: f64,
    unheld: f64,
) -> f64 {
    let without = unheld.max(0.0);
    let (mut open, mut asked) = (without, without);
    for layer in column
        .iter()
        .filter(|layer| layer.traditions != changed(layer.traditions, changes))
    {
        open += layer.people * (1.0 - layer.hardness);
        asked += layer.people;
    }
    let taken = if asked > 0.0 {
        people.max(0.0).min(asked) * open / asked
    } else {
        0.0
    };
    if taken <= TRACE {
        return 0.0;
    }
    let mut arriving = vec![IdentityLayer {
        people: taken * without / open,
        hardness,
        age: 0.0,
        traditions: changed([0; 5], changes),
    }];
    for layer in column
        .iter_mut()
        .filter(|layer| layer.traditions != changed(layer.traditions, changes))
    {
        let moved = taken * layer.people * (1.0 - layer.hardness) / open;
        layer.people -= moved;
        arriving.push(IdentityLayer {
            people: moved,
            traditions: changed(layer.traditions, changes),
            ..layer.clone()
        });
    }
    arrive(column, &arriving);
    taken
}
pub fn part(column: &mut IdentityColumn, share: f64) -> IdentityColumn {
    let leaving = share.clamp(0.0, 1.0);
    let parted = column
        .iter()
        .map(|layer| IdentityLayer {
            people: layer.people * leaving,
            ..layer.clone()
        })
        .filter(|layer| layer.people > TRACE)
        .collect();
    for layer in column.iter_mut() {
        layer.people *= 1.0 - leaving;
    }
    settle(column);
    parted
}
pub fn reexpose(column: &mut IdentityColumn, people: f64) {
    let (mut owed, mut fallen, mut last) = (people.max(0.0), 0.0, None);
    for (index, layer) in column.iter_mut().enumerate() {
        if owed <= 0.0 {
            break;
        }
        let taken = layer.people.min(owed);
        layer.people -= taken;
        owed -= taken;
        fallen += taken;
        last = Some(index);
    }
    if let Some(beneath) = last.and_then(|index| column.get_mut(index + 1)) {
        beneath.people += fallen;
    }
    settle(column);
}
pub fn fit(column: &mut IdentityColumn, people: f64) {
    let held: f64 = column.iter().map(|layer| layer.people).sum();
    if held > TRACE {
        let scale = people.max(0.0) / held;
        for layer in column.iter_mut() {
            layer.people *= scale;
        }
    }
    settle(column);
}
/// At most one accumulator per layer in this detached cell column.
pub fn held(column: &[IdentityLayer], field: Tradition) -> Vec<(i32, f64)> {
    let mut result: Vec<(i32, f64)> = Vec::new();
    for layer in column {
        let code = layer.traditions[field as usize];
        if code <= 0 {
            continue;
        }
        if let Some((_, people)) = result.iter_mut().find(|(held, _)| *held == code) {
            *people += layer.people;
        } else {
            result.push((code, layer.people));
        }
    }
    result
}
pub fn leading(column: &[IdentityLayer], field: Tradition) -> (i32, f64) {
    held(column, field)
        .into_iter()
        .fold((0, 0.0), |(code, most), (candidate, people)| {
            if people > most || (people == most && candidate < code) {
                (candidate, people)
            } else {
                (code, most)
            }
        })
}
