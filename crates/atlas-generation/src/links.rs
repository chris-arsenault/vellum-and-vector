//! Offerers contribute non-adjacent steps; travellers need not know who supplied them.
use std::io;
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Link {
    pub a: usize,
    pub b: usize,
    pub cost: f64,
}
type Provider<S> = dyn Fn(&S) -> io::Result<Vec<Link>>;
struct Offer<S> {
    id: usize,
    by: String,
    links: Box<Provider<S>>,
}
pub struct Offers<S> {
    next: usize,
    offers: Vec<Offer<S>>,
}
impl<S> Default for Offers<S> {
    fn default() -> Self {
        Self {
            next: 0,
            offers: Vec::new(),
        }
    }
}
impl<S> Offers<S> {
    pub fn offer(
        &mut self,
        by: impl Into<String>,
        links: impl Fn(&S) -> io::Result<Vec<Link>> + 'static,
    ) -> usize {
        let id = self.next;
        self.next += 1;
        self.offers.push(Offer {
            id,
            by: by.into(),
            links: Box::new(links),
        });
        id
    }
    pub fn withdraw(&mut self, id: usize) {
        self.offers.retain(|offer| offer.id != id);
    }
    pub fn offered_by(&self) -> impl Iterator<Item = &str> {
        self.offers.iter().map(|offer| offer.by.as_str())
    }
    pub fn links(&self, state: &S) -> io::Result<Vec<Link>> {
        let mut links = Vec::new();
        for offer in &self.offers {
            links.extend((offer.links)(state)?);
        }
        Ok(links)
    }
}
