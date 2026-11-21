# LAN backend

The backend runs the shared Rust generator and stores both completed generation inputs
and published maps on TrueNAS. The browser reads published GIS products through the
HTTP facade. The same service serves the backend-mode frontend, so other home devices
open `http://<private-TrueNAS-name>:4123/` without a separate frontend origin.

The Compose `database` service uses the custom image in `database/`, based on
PostgreSQL 18 with PostGIS. Its first-start initializer creates `vellum_maps` with
PostGIS and its `map` schema, and `vellum_generation` with its private `generation`
schema. The application uses independent map-writer, map-reader and generation-writer
logins. The reader cannot write maps or connect to the generation database. The service
creates tables through the writers. PostgreSQL requires password authentication for
network connections, with separate credentials for the administrator and each application role.
The database port is bound only to host loopback at `127.0.0.1:54328`, which the
host-networked Rust service uses. The shared TrueNAS PostgreSQL app is independent.

`platform.yml` enables the shared CI/CD TrueNAS deployment and publishes the `atlas`
and `database` images. Project Terraform generates the four database passwords and stores
them as SSM SecureString parameters under `/ahara/vellum-and-vector/database/`.
The shared deployment resolves the paths in `secret-paths.yml` through the Komodo proxy
and injects credentials into Compose. No manually supplied deployment passwords or LAN
certificates are needed. The project deployer has scoped SSM write permission for these paths.
The shared TrueNAS provisioner must have Vellum removed from its registration before
deploying this Compose stack; the removal does not delete previously created databases.
`.env.example` supplies placeholders for local configuration checks and optional address
and port overrides; deployed credentials come from the platform.

CI builds the declared `atlas_server` binary into `atlas/dist/`. The frontend build
also stages its output in `atlas/frontend/dist/`. `atlas/Dockerfile` packages those outputs.
The native server sets
backend mode in the served HTML; static hosting declares browser mode. Backend mode
uses the same-origin HTTP facade and does not initialize a local generation worker.
An unavailable backend remains an error rather than selecting a different host.

For a local packaging check on Linux with the native and WASM toolchains installed:

```sh
make build-lan
docker build -t vellum-and-vector:local atlas
docker build -t vellum-database:local database
```

Build the executable for the container architecture and Ubuntu 26.04 runtime,
matching the shared CI job's native build environment.
Deployment uses the existing Ahara CI image publication and Komodo stack workflow.
Compose consumes both GHCR images at `IMAGE_TAG`; it does not compile Rust on TrueNAS.
For a local database-only check, supply temporary credentials through environment variables
and run `docker compose up --build database`. In Sulion, use `with-cred --` for commands
that consume provisioned credentials; other installations use their normal credential environment.
The frontend creates identifiers without requiring HTTPS-only browser APIs.

Compose uses persistent Docker volumes on TrueNAS for data and disposable scratch,
initialized with the image's application-user ownership.
The private TrueNAS bind address
defaults to `192.168.66.3`; `ATLAS_LAN_IP` can override it. The service
refuses wildcard or public bind addresses. This
installation has no public proxy route, cloud database or RDS dependency.

The `atlas-postgres` volume retains the PostgreSQL cluster across container recreation.
Initialization runs only on an empty volume.
Back up both atlas databases together with the `atlas-data` volume. `maps/` contains
published GIS assets; `generation/` contains the private immutable resources needed for
later refinement. Scratch is disposable and is not a checkpoint. Stopping the service
ends running jobs; completed maps and explicit saves remain available. Explicit saves
include presentation and navigation state, while unsaved view changes remain in the
open browser tab.

The saved-map dialog also lists the server's generation jobs. Another device can open
the same job to see progress, cancel it, or open its completed map. This list lasts for
the server process; it is not a saved execution queue.

For local database-only development, `compose.database.yaml` supplies an isolated PostGIS
instance. `make test-postgis` uses its own temporary testcontainer instead. Neither command
contacts the TrueNAS database.

## Agent authoring over MCP

`atlas_mcp` is a Model Context Protocol server over stdio (newline-delimited JSON-RPC). It
adapts the backend's `/api/maps/*` CBOR calls into agent tools, so an agent authors maps with
the same operations as the editor ([ADR 0019](adr/0019-authored-maps.md)); it holds no map
logic and no state of its own. The backend URL is the first argument, else `ATLAS_URL`, else
`http://127.0.0.1:4123`. The URL is plain `http://`.

```sh
cargo build --release -p atlas-host --bin atlas_mcp
claude mcp add atlas -- target/release/atlas_mcp http://host:port
```

Tools: `list_maps`, `create_map`, `describe_map`, `list_kinds`, `query_features`,
`apply_edit`, `edit_terrain`, `undo`, `redo` and `edit_history`. Maps are named by the
`{mapId, revision}` reference that `create_map` and `list_maps` return. Failed backend calls
come back as tool errors with the backend's message. Lists are capped at 200 items with a
`truncated` flag.
