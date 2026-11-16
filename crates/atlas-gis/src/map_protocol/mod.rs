//! The same map requests serve the local worker and LAN transport.
mod editing;
mod library;
mod navigation;
mod read;
mod spatial;
pub use editing::EditingCall;
pub use library::LibraryCall;
pub use navigation::NavigationCall;
pub use read::ReadCall;
