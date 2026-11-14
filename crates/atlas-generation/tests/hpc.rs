use atlas_generation::hpc::*;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

#[test]
fn columnar_fifo_keeps_records_aligned_across_growth_and_reuse() {
    let mut queue = RecordQueue::<2>::default();
    for i in 0..180 {
        queue.push(i, [i as f64, -(i as f64)]);
    }
    for i in 0..120 {
        assert_eq!(queue.pop(), Some((i, [i as f64, -(i as f64)])));
    }
    for i in 180..320 {
        queue.push(i, [i as f64, -(i as f64)]);
    }
    for i in 120..320 {
        assert_eq!(queue.pop(), Some((i, [i as f64, -(i as f64)])));
    }
    assert!(queue.pop().is_none());
    queue.push(2, [3.0, 4.0]);
    queue.clear();
    assert!(queue.is_empty());
}

#[test]
fn packed_membership_counts_and_traverses_word_boundaries() {
    let mut set = BitSet::new(130);
    for i in [0, 63, 64, 129] {
        assert!(set.add(i));
        assert!(!set.add(i));
    }
    assert_eq!(set.count(), 4);
    assert_eq!(set.next_set(1), Some(63));
    assert_eq!(set.next_set(130), None);
    set.clear(63);
    assert_eq!(set.next_set(1), Some(64));
}

#[test]
fn work_coalescing_allows_requeue_after_consumption() {
    let mut work = Worklist::new(130);
    assert!(work.add(129));
    assert!(!work.add(129));
    assert_eq!(work.take(), Some(129));
    assert!(work.add(129));
    assert_eq!(work.take(), Some(129));
    assert!(work.is_empty());
}

#[test]
fn heaps_observe_all_key_directions_and_item_ties() {
    let mut heap = MultiKeyHeap::new(
        [Direction::Ascending, Direction::Descending],
        Direction::Ascending,
    );
    for (item, keys) in [
        (5, [1.0, 2.0]),
        (2, [1.0, 2.0]),
        (4, [0.0, 1.0]),
        (1, [1.0, 3.0]),
    ] {
        heap.push(item, keys);
    }
    let items: Vec<_> = std::iter::from_fn(|| heap.pop().map(|v| v.0)).collect();
    assert_eq!(items, [4, 1, 2, 5]);
    assert!(TopK::new(0).best().is_empty());
    let mut best = TopK::new(2);
    for (item, score) in [(6, 2.0), (4, 3.0), (1, 3.0), (0, 1.0)] {
        best.consider(item, score);
    }
    assert_eq!(best.best(), [1, 4]);
}

#[test]
fn radix_handles_signed_zero_infinities_stability_and_secondary_keys() {
    let primary = [0.0, -0.0, f64::NEG_INFINITY, f64::INFINITY, -2.0, 0.0];
    let secondary = [2, 1, 8, 0, 3, 1];
    assert_eq!(
        radix_order(
            &[NumericKey::Float(&primary), NumericKey::Signed(&secondary)],
            Direction::Ascending
        )
        .unwrap(),
        [2, 4, 1, 5, 0, 3]
    );
    assert!(radix_order(&[NumericKey::Float(&[f64::NAN])], Direction::Ascending).is_err());
    assert_eq!(
        radix_order(
            &[NumericKey::Float(&[0.0, -0.0, 2.0, 2.0])],
            Direction::Descending
        )
        .unwrap(),
        [2, 3, 0, 1]
    );
}

#[test]
fn pair_ids_survive_rehash_and_restart_after_clear() {
    let mut pairs = IntPairIndex::default();
    for i in -120..120 {
        let id = pairs.include(i, -i);
        assert_eq!(pairs.pair(id), (i, -i));
    }
    for i in -120..120 {
        assert_eq!(pairs.include(i, -i), (i + 120) as usize);
    }
    pairs.clear();
    assert_eq!(pairs.include(-5, 4), 0);
    assert_eq!(pairs.pair(0), (-5, 4));
}

#[test]
fn components_and_grouped_members_keep_requested_identity_policies() {
    let mut union = UnionFind::new(5);
    assert!(!union.active(2));
    for i in 0..5 {
        union.make(i);
    }
    union.union(0, 1);
    union.union(0, 2);
    union.attach(4, 0);
    assert_eq!(union.find(1), 4);
    assert_eq!(union.size(2), 4);
    let groups = group_by_label(&[1, -1, 0, 1, 0], 3);
    assert_eq!(groups.members_of(0), [2, 4]);
    assert_eq!(groups.members_of(1), [0, 3]);
    assert!(groups.members_of(2).is_empty());
}
