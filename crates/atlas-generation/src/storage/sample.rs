mod sealed {
    pub trait Sealed {}
    impl Sealed for f64 {}
    impl Sealed for f32 {}
    impl Sealed for i32 {}
    impl Sealed for u32 {}
    impl Sealed for u8 {}
    impl Sealed for i8 {}
}
/// Packed scalar types only; generation cannot hide per-cell objects in a band.
/// ```compile_fail
/// use atlas_generation::storage::Sample;
/// #[repr(C)]
/// #[derive(Clone,Copy,Default,bytemuck::Pod,bytemuck::Zeroable)] struct CellObject { value: f64 }
/// impl Sample for CellObject {
///     const BYTES: usize = 8;
/// }
/// ```
pub trait Sample: sealed::Sealed + bytemuck::Pod + Default + 'static {
    const BYTES: usize;
}
macro_rules! sample {
    ($($kind:ty),*) => {$(impl Sample for $kind {
        const BYTES:usize=std::mem::size_of::<Self>();
    })*};
}
sample!(f64, f32, i32, u32, u8, i8);
