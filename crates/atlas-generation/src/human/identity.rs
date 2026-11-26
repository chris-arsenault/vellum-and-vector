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
    /// A tongue the layer's people know besides the one they speak: learned by contact,
    /// forgotten where no one around them uses it.
    Known,
}
/// How many traditions a layer of people holds.
pub const TRADITIONS: usize = 6;
impl Tradition {
    pub const ALL: [Self; TRADITIONS] = [
        Self::Tongue,
        Self::Faith,
        Self::Custom,
        Self::Allegiance,
        Self::Craft,
        Self::Known,
    ];
    /// The name each tradition's band takes in storage and publication.
    pub const NAMES: [&'static str; TRADITIONS] =
        ["Tongue", "Faith", "Custom", "Allegiance", "Craft", "Known"];
    pub const SOCIAL: [Self; 4] = [Self::Tongue, Self::Faith, Self::Custom, Self::Allegiance];
}
// Arconis: docs/architecture/subsystems.arconis#item=pp_layers — one entry of the people's identity column.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct IdentityLayer {
    pub people: f64,
    pub hardness: f64,
    pub age: f64,
    pub traditions: [i32; TRADITIONS],
}
pub type IdentityColumn = Vec<IdentityLayer>;
pub type TraditionChanges = [Option<i32>; TRADITIONS];
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
        inherit_known(&mut column[to], &lost);
        // The heir retains its own age and hardness; only its holding grows.
        column[to].people += lost.people;
    }
}
/// When a layer that knows a second tongue joins one that does not, the joined layer knows it
/// with the chance of the knowers' share of them: over the cells of a country, as many people
/// know the tongue as before, held whole by some layers rather than lost from all. A coarse
/// share is realised as shares of the cells, not as every cell holding a little.
fn inherit_known(heir: &mut IdentityLayer, lost: &IdentityLayer) {
    let (tongue, known) = (Tradition::Tongue as usize, Tradition::Known as usize);
    let learned = lost.traditions[known];
    if learned == 0
        || learned == heir.traditions[known]
        || learned == heir.traditions[tongue]
        || heir.traditions[known] != 0
    {
        return;
    }
    let share = lost.people / (lost.people + heir.people).max(f64::EPSILON);
    if dither(lost, heir) < share {
        heir.traditions[known] = learned;
    }
}
/// A fraction in [0, 1) that is the same for the same two layers and spread evenly over many:
/// the deciding draw of `inherit_known`.
fn dither(a: &IdentityLayer, b: &IdentityLayer) -> f64 {
    let mut hash = 0x9e37_79b9_7f4a_7c15_u64;
    for value in [
        a.people.to_bits(),
        b.people.to_bits(),
        a.traditions[0] as u64,
        b.traditions[0] as u64,
    ] {
        hash ^= value;
        hash = hash.wrapping_mul(0xbf58_476d_1ce4_e5b9);
        hash ^= hash >> 31;
    }
    (hash >> 11) as f64 / (1u64 << 53) as f64
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
    accumulate(column, arriving);
    settle(column);
}

pub(crate) fn accumulate(column: &mut IdentityColumn, arriving: &[IdentityLayer]) {
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
}
fn changed(traditions: [i32; TRADITIONS], changes: &TraditionChanges) -> [i32; TRADITIONS] {
    let (tongue, known) = (Tradition::Tongue as usize, Tradition::Known as usize);
    let mut next: [i32; TRADITIONS] =
        std::array::from_fn(|index| changes[index].unwrap_or(traditions[index]));
    // A second tongue is another people's: those who speak a tongue do not also "know" it.
    // Teaching people the tongue they speak leaves what they know; people who take up the
    // tongue they knew no longer know it as a second one.
    if next[known] == next[tongue] {
        next[known] = if changes[tongue].is_none() {
            traditions[known]
        } else {
            0
        };
    }
    next
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
        traditions: changed([0; TRADITIONS], changes),
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
#[cfg(test)]
mod tests {
    use super::*;

    fn realm_of(code: i32, people: f64) -> IdentityLayer {
        let mut traditions = [0; TRADITIONS];
        traditions[Tradition::Allegiance as usize] = code;
        traditions[Tradition::Tongue as usize] = 1;
        IdentityLayer {
            people,
            traditions,
            ..Default::default()
        }
    }
    #[test]
    fn people_no_realm_reaches_forget_it_by_the_share_overlaid() {
        let mut column = vec![realm_of(4, 100.0)];
        let mut lost = [None; TRADITIONS];
        lost[Tradition::Allegiance as usize] = Some(0);
        let taken = overlay(&mut column, &lost, 40.0, 0.0, 0.0);
        assert!((taken - 40.0).abs() < 1e-9);
        let (realm, holding) = leading(&column, Tradition::Allegiance);
        assert_eq!(realm, 4);
        assert!((holding - 60.0).abs() < 1e-9);
        // Their tongue is untouched.
        assert!((leading(&column, Tradition::Tongue).1 - 100.0).abs() < 1e-9);
    }
    #[test]
    fn a_full_column_keeps_its_countrys_share_of_knowers_when_learners_join_their_twins() {
        let layer = |people: f64, tongue: i32, faith: i32, known: i32| {
            let mut traditions = [0; TRADITIONS];
            traditions[Tradition::Tongue as usize] = tongue;
            traditions[Tradition::Faith as usize] = faith;
            traditions[Tradition::Known as usize] = known;
            IdentityLayer {
                people,
                traditions,
                ..Default::default()
            }
        };
        let (mut learned, mut kept) = (0.0, 0.0);
        for i in 0..2000 {
            let learners = 1.0 + (i % 37) as f64;
            let speakers = 60.0 + (i % 53) as f64;
            // Four layers fill the column; the learners are the twins of the first.
            let mut column = vec![
                layer(speakers, 1, 1, 0),
                layer(50.0, 1, 2, 0),
                layer(40.0, 3, 1, 0),
                layer(30.0, 3, 2, 0),
                layer(learners, 1, 1, 2),
            ];
            learned += learners;
            settle(&mut column);
            assert_eq!(column.len(), IDENTITY_SLOTS);
            kept += column
                .iter()
                .filter(|l| l.traditions[Tradition::Known as usize] == 2)
                .map(|l| l.people)
                .sum::<f64>();
        }
        // Each joined column knows the tongue whole or not at all, and over the country as many
        // know it as learned it.
        let ratio = kept / learned;
        assert!(
            (0.9..1.1).contains(&ratio),
            "kept {kept} of {learned} learned"
        );
    }
    #[test]
    fn people_never_know_their_own_tongue_as_a_second_one() {
        // Speakers of tongue 1 reached by tongue 1 as a tongue to know learn nothing.
        let mut column = vec![realm_of(4, 100.0)];
        let mut teach = [None; TRADITIONS];
        teach[Tradition::Known as usize] = Some(1);
        overlay(&mut column, &teach, 50.0, 0.0, 0.0);
        assert_eq!(leading(&column, Tradition::Known).0, 0);
        // Taking up a tongue they already know clears it as known.
        let mut taught = [None; TRADITIONS];
        taught[Tradition::Known as usize] = Some(2);
        overlay(&mut column, &taught, 100.0, 0.0, 0.0);
        let mut speak = [None; TRADITIONS];
        speak[Tradition::Tongue as usize] = Some(2);
        overlay(&mut column, &speak, 100.0, 0.0, 0.0);
        assert_eq!(leading(&column, Tradition::Tongue).0, 2);
        assert_eq!(leading(&column, Tradition::Known).0, 0);
    }
}
