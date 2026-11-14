//! The same map requests serve the local worker and LAN transport.
mod library;
mod navigation;
mod read;
mod spatial;
pub use library::LibraryCall;
pub use navigation::NavigationCall;
pub use read::ReadCall;
