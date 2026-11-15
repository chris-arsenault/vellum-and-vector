# LAN backend

The backend runs the shared Rust generator and stores both completed generation inputs
and published maps on TrueNAS. The browser reads published GIS products through the
HTTP facade. The same service serves the backend-mode frontend, so other home devices
open `https://<private-TrueNAS-name>:4123/` without a separate frontend origin.

The Ahara Infra TrueNAS database registration provisions `vellum_maps` with PostGIS
and its `map` schema, and `vellum_generation` with its private `generation` schema on
the existing TrueNAS PostgreSQL instance. Each database has independent writer and
reader roles. The application uses the map writer, map reader and generation writer;
viewing uses only the map reader. The service creates tables through their respective
writers. No runtime database-administrator connection is needed.

`platform.yml` enables the shared CI/CD TrueNAS deployment. Before deploying the
Komodo stack, the workflow invokes the registered database provisioner and resolves
the three connections from `secret-paths.yml`. The Ahara Infra registration and
provisioner must be deployed before this application's first deployment.
`.env.example` contains placeholders for local configuration. In Sulion, use
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

Build the executable for the container architecture and Ubuntu 26.04 runtime,
matching the shared CI job's native build environment.
Deployment uses the existing Ahara CI image publication and Komodo stack workflow.
Compose consumes the GHCR image at `IMAGE_TAG`; it does not compile on TrueNAS.

Use an existing certificate for the LAN hostname, trusted by the home devices, and its
PEM private key. Compose mounts them read-only; certificate issuance and renewal stay
with the existing LAN certificate service. HTTPS is needed for browser APIs such as
creating map and view identities. Loopback development can use the executable's HTTP mode.

Compose uses persistent Docker volumes on TrueNAS for data and disposable scratch,
initialized with the image's application-user ownership. The existing certificate
paths still need deployment configuration: the repository has placeholders, and the
actual TrueNAS paths have not been verified. Configure them through the deployment
source, since the shared action replaces Komodo's environment on each deployment.
The private TrueNAS bind address
defaults to `192.168.66.3`; `ATLAS_LAN_IP` can override it. The service
refuses wildcard or public bind addresses. This
installation has no public proxy route, cloud database or RDS dependency.

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
