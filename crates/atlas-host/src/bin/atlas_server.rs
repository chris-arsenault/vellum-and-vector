use atlas_gis::{map_files::MapFiles, postgres_maps::PostgresMaps};
use atlas_host::{
    map_http::{self, Services},
    native_jobs::{Jobs, Settings},
    private_inputs::PrivateInputs,
};
use std::{
    env, io,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
};
// Arconis: docs/architecture/subsystems.arconis#item=native_generator — native host that generates and publishes into PostGIS.
fn main() -> io::Result<()> {
    let address: SocketAddr = env::var("ATLAS_BIND")
        .unwrap_or_else(|_| "127.0.0.1:4123".into())
        .parse()
        .map_err(io::Error::other)?;
    // owner-direction(2026-11-13): backend has LAN-only access and no public route
    if !lan(address.ip()) {
        return Err(io::Error::other(
            "Bind the atlas backend to a loopback or private LAN address",
        ));
    }
    let writer = PostgresMaps::connect(&required("ATLAS_MAP_DATABASE_URL")?)?;
    writer.initialize()?;
    let reader = PostgresMaps::connect(&required("ATLAS_MAP_READER_URL")?)?;
    let files = MapFiles::new(required("ATLAS_MAP_ASSETS")?);
    let jobs = match env::var("ATLAS_GENERATION_DATABASE_URL") {
        Ok(generation_url) => {
            PrivateInputs::connect(&generation_url)?.initialize()?;
            Some(Jobs::new(Settings {
                database_url: required("ATLAS_MAP_DATABASE_URL")?,
                generation_url,
                resources: required("ATLAS_GENERATION_RESOURCES")?.into(),
                scratch: required("ATLAS_GENERATION_SCRATCH")?.into(),
                assets: files.clone(),
                memory: atlas_host::host_memory::generation_budget()?,
            })?)
        }
        Err(env::VarError::NotPresent) => None,
        Err(error) => return Err(io::Error::other(error)),
    };
    let (server, scheme) = match env::var_os("ATLAS_TLS_CERTIFICATE") {
        Some(path) => (
            tiny_http::Server::https(
                address,
                tiny_http::SslConfig {
                    certificate: std::fs::read(path)?,
                    private_key: std::fs::read(required("ATLAS_TLS_PRIVATE_KEY")?)?,
                },
            )
            .map_err(io::Error::other)?,
            "https",
        ),
        None => (
            tiny_http::Server::http(address).map_err(io::Error::other)?,
            "http",
        ),
    };
    println!("{scheme}://{}/", server.server_addr());
    map_http::serve(
        Arc::new(server),
        Arc::new(Services {
            reader: Mutex::new(reader),
            writer: Mutex::new(writer),
            files,
            jobs,
            frontend: env::var_os("ATLAS_FRONTEND").map(Into::into),
        }),
    )
}
fn required(name: &str) -> io::Result<String> {
    env::var(name).map_err(|_| io::Error::other(format!("Set {name}")))
}
fn lan(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(a) => a.is_loopback() || a.is_private() || a.is_link_local(),
        IpAddr::V6(a) => a.is_loopback() || a.is_unique_local() || a.is_unicast_link_local(),
    }
}
