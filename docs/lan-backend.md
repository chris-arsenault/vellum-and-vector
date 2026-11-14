# LAN backend

The backend runs the shared Rust generator and stores both completed generation inputs
and published maps on TrueNAS. The browser reads published GIS products through the
HTTP facade. The same service serves the backend-mode frontend, so other home devices
open `https://<private-TrueNAS-name>:4123/` without a separate frontend origin.

Use the TrueNAS PostgreSQL instance with PostGIS installed and a dedicated atlas database.
Provision three independent login roles: a map writer, a read-only map reader and a
generation writer. As the database administrator, run:

```sh
psql "$ATLAS_ADMIN_DATABASE_URL" \
  -v map_writer=atlas_map_writer -v map_reader=atlas_map_reader \
  -v generation_writer=atlas_generation_writer \
  -f infrastructure/lan/database.sql
```

The bootstrap assigns separate schema ownership and grants the reader access only to
published map tables. The service creates its tables under the corresponding writer.
The map reader must not inherit either writer role. Supply connection strings through
the deployment environment; `.env.example` contains placeholders. In Sulion, use
`with-cred --` for secret-backed commands rather than writing credentials into files.
Other installations can supply ordinary environment variables.

CI builds the declared `atlas_server` binary into `dist/` and the ordinary frontend
into `frontend/dist/`. The Dockerfile packages those outputs. The native server sets
backend mode in the served HTML; static hosting declares browser mode. Backend mode
uses the same-origin HTTP facade and does not initialize a local generation worker.
An unavailable backend remains an error rather than selecting a different host.

For a local packaging check on Linux with the native and WASM toolchains installed:

```sh
make build-lan
docker build -t vellum-and-vector:local .
```

Build the executable for the container architecture and a compatible glibc version.
Deployment uses the existing Ahara CI image publication and Komodo stack workflow.
Compose consumes the GHCR image at `IMAGE_TAG`; it does not compile on TrueNAS.

Use an existing certificate for the LAN hostname, trusted by the home devices, and its
PEM private key. Compose mounts them read-only; certificate issuance and renewal stay
with the existing LAN certificate service. HTTPS is needed for browser APIs such as
creating map and view identities. Loopback development can use the executable's HTTP mode.

Create the data and scratch directories from `.env.example`, owned by the configured
container UID/GID. Set the private TrueNAS address, all three database connections and
these directory and certificate paths in Komodo's stack environment. The service
refuses wildcard or public bind addresses. This
installation has no public proxy route, cloud database or RDS dependency.

Back up the atlas database together with the persistent data directory. `maps/` contains
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
