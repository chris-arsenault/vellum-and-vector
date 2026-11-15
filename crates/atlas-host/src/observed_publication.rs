//! Report committed GIS availability; private numerical data never enters this notification.
use atlas_map::{MapDescriptor, MapLayer, MapRef, PublicationBatch, PublishedAsset, Publisher};
use std::io;

// Arconis: docs/architecture/subsystems.arconis#item=j_observed — publisher wrapper that reports visible map changes.
pub struct Observed<'a, P, F> {
    pub publisher: &'a mut P,
    pub changed: F,
    pub visible: bool,
}
impl<P: Publisher, F: FnMut(&MapRef) -> io::Result<()>> Publisher for Observed<'_, P, F> {
    fn begin(
        &mut self,
        map: &MapDescriptor,
        expected: Option<&MapRef>,
        progressive: bool,
    ) -> io::Result<()> {
        self.publisher.begin(map, expected, progressive)?;
        self.visible = progressive;
        self.notify(&map.reference)
    }
    fn append(&mut self, reference: &MapRef, batch: PublicationBatch) -> io::Result<()> {
        self.publisher.append(reference, batch)?;
        self.notify(reference)
    }
    fn add_layers(
        &mut self,
        reference: &MapRef,
        layers: &[MapLayer],
        asset: PublishedAsset,
    ) -> io::Result<()> {
        self.publisher.add_layers(reference, layers, asset)?;
        self.notify(reference)
    }
    fn finish(&mut self, reference: &MapRef) -> io::Result<()> {
        self.publisher.finish(reference)?;
        self.visible = true;
        self.notify(reference)
    }
    fn discard(&mut self, reference: &MapRef) -> io::Result<()> {
        self.publisher.discard(reference)?;
        self.notify(reference)
    }
}
impl<P, F: FnMut(&MapRef) -> io::Result<()>> Observed<'_, P, F> {
    fn notify(&mut self, reference: &MapRef) -> io::Result<()> {
        if self.visible {
            (self.changed)(reference)?;
        }
        Ok(())
    }
}
