//! Identities of maps, revisions, areas, features and entities: 128-bit values compared and
//! hashed as numbers. They are written as UUID text only where a person or the browser reads
//! them (serde and TypeScript), and as 16 bytes in storage.
use serde::{de, Deserialize, Deserializer, Serialize, Serializer};
use std::{fmt, str::FromStr};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Id(pub u128);

impl Id {
    pub const NIL: Self = Self(0);
    pub fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(u128::from_be_bytes(bytes))
    }
    pub fn to_bytes(self) -> [u8; 16] {
        self.0.to_be_bytes()
    }
    /// The identity of `name` in `namespace` as RFC 4122 version 5 defines it, from a SHA-1
    /// digest of the namespace bytes followed by the name bytes.
    pub fn v5(namespace: Self, name: &[u8]) -> Self {
        let mut message = Vec::with_capacity(16 + name.len());
        message.extend_from_slice(&namespace.to_bytes());
        message.extend_from_slice(name);
        let digest = sha1(&message);
        let mut bytes = [0; 16];
        bytes.copy_from_slice(&digest[..16]);
        bytes[6] = (bytes[6] & 0x0f) | 0x50;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        Self::from_bytes(bytes)
    }
    /// The version 5 identity of a name in the nil namespace, for fixed names such as a test
    /// fixture's features.
    pub fn from_name(name: &str) -> Self {
        Self::v5(Self::NIL, name.as_bytes())
    }
}
impl From<Id> for serde_json::Value {
    fn from(id: Id) -> Self {
        Self::String(id.to_string())
    }
}

impl fmt::Display for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let b = self.to_bytes();
        write!(
            f,
            "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13],
            b[14], b[15]
        )
    }
}
impl fmt::Debug for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}
#[derive(Debug, PartialEq, Eq)]
pub struct InvalidId;
impl fmt::Display for InvalidId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("An identity is 32 hexadecimal digits, optionally hyphenated")
    }
}
impl std::error::Error for InvalidId {}
impl FromStr for Id {
    type Err = InvalidId;
    fn from_str(text: &str) -> Result<Self, InvalidId> {
        let mut value = 0u128;
        let mut digits = 0;
        for c in text.chars().filter(|&c| c != '-') {
            let digit = c.to_digit(16).ok_or(InvalidId)?;
            value = (value << 4) | u128::from(digit);
            digits += 1;
        }
        (digits == 32).then_some(Self(value)).ok_or(InvalidId)
    }
}

impl Serialize for Id {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}
impl<'de> Deserialize<'de> for Id {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Read;
        impl de::Visitor<'_> for Read {
            type Value = Id;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a UUID or 16 identity bytes")
            }
            fn visit_str<E: de::Error>(self, text: &str) -> Result<Id, E> {
                text.parse().map_err(E::custom)
            }
            fn visit_bytes<E: de::Error>(self, bytes: &[u8]) -> Result<Id, E> {
                <[u8; 16]>::try_from(bytes)
                    .map(Id::from_bytes)
                    .map_err(|_| E::custom(InvalidId))
            }
        }
        deserializer.deserialize_any(Read)
    }
}
impl ts_rs::TS for Id {
    type WithoutGenerics = Self;
    type OptionInnerType = Self;
    fn name(_: &ts_rs::Config) -> String {
        "string".into()
    }
    fn inline(cfg: &ts_rs::Config) -> String {
        Self::name(cfg)
    }
}

/// SHA-1 (FIPS 180-4), needed only for version 5 identities.
fn sha1(message: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [
        0x6745_2301,
        0xEFCD_AB89,
        0x98BA_DCFE,
        0x1032_5476,
        0xC3D2_E1F0,
    ];
    let mut data = message.to_vec();
    let bits = (message.len() as u64).wrapping_mul(8);
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend_from_slice(&bits.to_be_bytes());
    for block in data.as_chunks::<64>().0 {
        let mut w = [0u32; 80];
        for (i, word) in block.as_chunks::<4>().0.iter().enumerate() {
            w[i] = u32::from_be_bytes(*word);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, &word) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let next = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = next;
        }
        for (state, value) in h.iter_mut().zip([a, b, c, d, e]) {
            *state = state.wrapping_add(value);
        }
    }
    let mut digest = [0; 20];
    for (chunk, word) in digest.as_chunks_mut::<4>().0.iter_mut().zip(h) {
        chunk.copy_from_slice(&word.to_be_bytes());
    }
    digest
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn an_identity_reads_and_writes_as_uuid_text() {
        let text = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
        let id: Id = text.parse().unwrap();
        assert_eq!(id.to_string(), text);
        assert_eq!(
            "6ba7b8109dad11d180b400c04fd430c8".parse::<Id>().unwrap(),
            id
        );
        assert!("not an id".parse::<Id>().is_err());
        assert_eq!(Id::from_bytes(id.to_bytes()), id);
    }
    #[test]
    fn a_version_5_identity_matches_rfc_4122() {
        // The DNS namespace and "www.example.com" give this identity in every UUID library.
        let dns: Id = "6ba7b810-9dad-11d1-80b4-00c04fd430c8".parse().unwrap();
        assert_eq!(
            Id::v5(dns, b"www.example.com").to_string(),
            "2ed6657d-e927-568b-95e1-2665a8aea6a2"
        );
    }
}
