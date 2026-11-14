//! The existing per-invocation structure and variation streams.
use super::Values;
use crate::sequence::InvocationContext;

fn hash(text: &str) -> u32 {
    text.encode_utf16().fold(2_166_136_261, |held, unit| {
        (held ^ u32::from(unit)).wrapping_mul(16_777_619)
    })
}
pub struct Stream {
    key: u32,
    cursor: u64,
}
impl Stream {
    fn new(seed: &str, scope: &str, invocation: &str, stream: &str, iterations: &[&str]) -> Self {
        let key = serde_json::to_string(&(
            "atlas-counter-v1",
            seed,
            scope,
            invocation,
            stream,
            iterations,
        ))
        .expect("String-only stream identity");
        Self {
            key: hash(&key),
            cursor: 0,
        }
    }
    pub fn sample(&mut self) -> f64 {
        let mut value = self.key ^ hash(&self.cursor.to_string());
        self.cursor += 1;
        value = (value ^ (value >> 16)).wrapping_mul(0x21f0aaad);
        value = (value ^ (value >> 15)).wrapping_mul(0x735a2d97);
        f64::from(value ^ (value >> 15)) / 4_294_967_296.0
    }
}
pub struct Streams {
    structure: Stream,
    variation: Stream,
}
impl Streams {
    pub fn new(seed: &str, scope: &str, context: &InvocationContext<'_, Values>) -> Self {
        let path = context.path.join("/");
        let epochs = context
            .epochs
            .iter()
            .map(|epoch| epoch.id.as_str())
            .collect::<Vec<_>>();
        Self {
            structure: Stream::new(seed, scope, &path, "structure", &[]),
            variation: Stream::new(seed, scope, &path, "variation", &epochs),
        }
    }
    pub fn sample(&mut self, persistent: bool) -> f64 {
        if persistent {
            self.structure.sample()
        } else {
            self.variation.sample()
        }
    }
}
