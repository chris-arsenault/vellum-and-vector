//! Feature extraction and publication: numerical outputs and generated records become GIS products.
//! This stage runs during map production. View requests read the resulting GIS store and never
//! invoke extraction or open its numerical inputs.
// Arconis: docs/architecture/subsystems.arconis#item=extraction — feature extraction reads numerical outputs and writes GIS.
pub mod catalogue;
pub mod channels;
pub mod descriptor;
pub mod fields;
pub mod geographies;
pub mod geotiff;
pub mod history;
pub mod illustration;
pub mod inspection;
pub mod key;
pub mod layers;
pub mod placed;
pub mod product;
pub mod raster;
pub mod registry;
pub mod samples;
pub mod sampling;
pub mod terrain;
pub mod upload;
pub mod vectors;
