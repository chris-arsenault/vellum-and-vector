//! A table's records held decoded in memory, in insertion order, with indexes for the
//! selections the generator makes. The SQLite table stays the durable copy that checkpoints,
//! recovery and child capture read; reads come from here and never decode a row.
use atlas_map::Id;
// hpc-exempt: record identities and selection keys of the generator's working records.
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::hash::Hash;

/// A selection field and its value: an area, layer, kind, feature or node.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) enum Key {
    Id(u8, Id),
    Text(u8, String),
}
pub(super) struct Mirror<K, T> {
    rows: BTreeMap<i64, Row<K, T>>,
    ordinals: HashMap<K, i64>,
    index: HashMap<Key, BTreeSet<i64>>,
    next: i64,
}
pub(super) struct Row<K, T> {
    pub key: K,
    pub revision: u64,
    pub keys: Vec<Key>,
    pub value: T,
}
impl<K: Copy + Eq + Hash, T: Clone> Mirror<K, T> {
    /// Rows as the table holds them, in ordinal order; `next` is the first ordinal never used.
    pub fn new(rows: impl IntoIterator<Item = (i64, Row<K, T>)>, next: i64) -> Self {
        let mut mirror = Self {
            rows: BTreeMap::new(),
            ordinals: HashMap::new(),
            index: HashMap::new(),
            next,
        };
        for (ordinal, row) in rows {
            mirror.insert(ordinal, row);
        }
        mirror.next = mirror
            .next
            .max(mirror.rows.keys().last().map_or(1, |o| o + 1));
        mirror
    }
    fn insert(&mut self, ordinal: i64, row: Row<K, T>) {
        for key in &row.keys {
            self.index.entry(key.clone()).or_default().insert(ordinal);
        }
        self.ordinals.insert(row.key, ordinal);
        self.rows.insert(ordinal, row);
    }
    /// The ordinal a record keeps, or the one a new record takes.
    pub fn ordinal(&self, key: K) -> i64 {
        self.ordinals.get(&key).copied().unwrap_or(self.next)
    }
    pub fn put(&mut self, row: Row<K, T>) -> i64 {
        let ordinal = self.ordinal(row.key);
        self.remove(row.key);
        self.next = self.next.max(ordinal + 1);
        self.insert(ordinal, row);
        ordinal
    }
    pub fn remove(&mut self, key: K) {
        let Some(ordinal) = self.ordinals.remove(&key) else {
            return;
        };
        if let Some(row) = self.rows.remove(&ordinal) {
            for key in row.keys {
                if let Some(set) = self.index.get_mut(&key) {
                    set.remove(&ordinal);
                }
            }
        }
    }
    pub fn clear(&mut self) {
        self.rows.clear();
        self.ordinals.clear();
        self.index.clear();
    }
    pub fn get(&self, key: K) -> Option<&Row<K, T>> {
        self.rows.get(self.ordinals.get(&key)?)
    }
    /// The first record after `after` that holds every key in `keys`, with its ordinal.
    /// Records written since the last call are seen, as a table scan would see them.
    pub fn next_after(&self, after: i64, keys: &[Key]) -> Option<(i64, &Row<K, T>)> {
        let narrowest = keys
            .iter()
            .map(|key| self.index.get(key))
            .min_by_key(|set| set.map_or(0, BTreeSet::len));
        let ordinals: Box<dyn Iterator<Item = i64>> = match narrowest {
            None => Box::new(self.rows.range(after + 1..).map(|(o, _)| *o)),
            Some(None) => return None,
            Some(Some(set)) => Box::new(set.range(after + 1..).copied()),
        };
        ordinals
            .filter_map(|ordinal| Some((ordinal, self.rows.get(&ordinal)?)))
            .find(|(_, row)| keys.iter().all(|key| row.keys.contains(key)))
    }
    pub fn rows(&self) -> impl Iterator<Item = &Row<K, T>> {
        self.rows.values()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(key: u8, area: &str, value: &str) -> Row<u8, String> {
        Row {
            key,
            revision: 0,
            keys: vec![Key::Text(0, area.into())],
            value: value.into(),
        }
    }
    #[test]
    fn selections_follow_insertion_order_and_see_later_writes() {
        let mut mirror = Mirror::new([(1, row(1, "a", "first")), (2, row(2, "b", "second"))], 3);
        mirror.put(row(3, "a", "third"));
        let area = [Key::Text(0, "a".into())];
        let (ordinal, found) = mirror.next_after(0, &area).unwrap();
        assert_eq!((ordinal, found.value.as_str()), (1, "first"));
        // A record rewritten keeps its place; one written during a scan is reached by it.
        mirror.put(row(1, "a", "rewritten"));
        mirror.put(row(4, "a", "fourth"));
        let rest: Vec<_> = std::iter::successors(mirror.next_after(ordinal, &area), |(o, _)| {
            mirror.next_after(*o, &area)
        })
        .map(|(_, row)| row.value.clone())
        .collect();
        assert_eq!(rest, ["third", "fourth"]);
        assert_eq!(mirror.get(1).unwrap().value, "rewritten");
        mirror.remove(3);
        assert_eq!(mirror.next_after(1, &area).unwrap().1.value, "fourth");
        assert!(mirror.next_after(0, &[Key::Text(0, "c".into())]).is_none());
        assert_eq!(mirror.next_after(0, &[]).unwrap().1.value, "rewritten");
    }
}
