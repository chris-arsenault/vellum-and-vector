use atlas_map::Id;

/// The identity of the record `key` of `kind` in a world: a version 5 identity in the world's
/// namespace over the kind and key bytes, so the same kind and key always name one record.
pub fn semantic_id(world: Id, kind: &str, key: &str) -> Id {
    let mut name = Vec::with_capacity(kind.len() + 1 + key.len());
    name.extend_from_slice(kind.as_bytes());
    // Kinds never contain a nul, so the boundary between kind and key is unambiguous.
    name.push(0);
    name.extend_from_slice(key.as_bytes());
    Id::v5(world, &name)
}
/// The identity of the record `key` that a world or regional generation of `area` makes: the
/// origin and area are fixed-width, so they and the key never run into each other.
pub fn area_record_id(world: Id, regional: bool, area: Id, key: &str) -> Id {
    let mut name = Vec::with_capacity(17 + key.len());
    name.push(u8::from(regional));
    name.extend_from_slice(&area.to_bytes());
    name.extend_from_slice(key.as_bytes());
    Id::v5(world, &name)
}
/// The identity of a record an area's generation makes for `key`.
pub fn generated_id(area: Id, key: &str) -> Id {
    semantic_id(area, "generated", key)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_semantic_identity_depends_on_world_kind_and_key() {
        let world = Id::from_name("world");
        let id = semantic_id(world, "landmark", "a:1");
        assert_eq!(id, semantic_id(world, "landmark", "a:1"));
        assert_ne!(id, semantic_id(world, "landmark", "a:2"));
        assert_ne!(id, semantic_id(world, "landmar", "ka:1"));
        assert_ne!(id, semantic_id(Id::from_name("other"), "landmark", "a:1"));
    }
}
