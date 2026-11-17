//! The same map requests serve the local worker and LAN transport.
mod addresses;
mod connections;
mod editing;
mod library;
mod navigation;
mod read;
mod site;
mod spatial;
pub use editing::EditingCall;
pub use library::LibraryCall;
pub use navigation::NavigationCall;
pub use read::ReadCall;
