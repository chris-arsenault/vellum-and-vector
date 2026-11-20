# Local atlas

The local atlas is the native server and its database on this machine, holding one kept
verification world that every worktree shares. Development checks that need a generated
map use it: the world, and real-scale maps opened from the world. Browser tests cover the
UI and use supplied fixture maps; they never generate.

## Parts

- **Database:** the production image built from `database/`, in the container
  `vellum-local-atlas-db`, on `127.0.0.1:54338`; the cluster lives in the Docker volume
  `vellum-local-atlas`.
- **Server:** the native release `atlas_server`, built from the checkout that starts it, on
  `http://127.0.0.1:44138/`. On a Sulion development node it binds the node's LAN address
  on port 26010, the range a LAN browser reaches. `ATLAS_LOCAL_HOST` and
  `ATLAS_LOCAL_PORT` choose another address. It also serves that checkout's `frontend/dist`.
- **State:** the main checkout's git-ignored `.artifacts/local-atlas/` holds the server's
  map files, generation resources and scratch, its log, the database passwords and the
  kept world's reference.
- **Reports:** each map's report, pictures and stage pictures are written under the
  git-ignored `.artifacts/local-atlas/` of the checkout that ran the check.

`ATLAS_LOCAL_HOME`, `ATLAS_LOCAL_PORT` and `ATLAS_LOCAL_DATABASE_PORT` override the
defaults.

The database passwords are made locally on first start. No external credential is needed.

## Use

```sh
make local-up        # start the database, then build and (re)start the server
make local-world     # reuse the kept world, or create it: 1,000 × 750 km Draft, seed 42
scripts/local-atlas.sh places              # the world's settlements and positions
scripts/local-atlas.sh census              # run human land processes on retained world layers
make local-real AT=Ajarma HEX=100m ACROSS=50     # a real-scale map at a settlement
make local-real AT=500000,375000 HEX=300m        # or at a point in world metres
scripts/local-atlas.sh region --at Amadir --width 120000 --name Amadir-country
scripts/local-atlas.sh region --parent Amadir-country --at Amadir --width 20000 --name Amadir-district
scripts/local-atlas.sh real --parent Amadir-district --at Amadir --hex 30m --across 100 --name Amadir-town
scripts/local-atlas.sh world --name Reference-world --width 4000000 --height 3000000
scripts/local-atlas.sh places --parent Reference-world     # a named world's settlements
make local-resume    # after fixing a failed step: make local-up, then resume the job
make local-down      # stop the server and database; the world stays
```

A named world is kept beside the kept world, under its own map folder, and is refined with
`region --parent <name>`. Each regional level refines on a fixed cell size (ADR 0005): a
region holds about the world's triangle count when it covers about a seventh of its
parent's area, and a region smaller than that refines on few triangles. A real-scale map's
count follows its hex size and the hexes across it.

`HEX` is one of 1.5m, 3m, 10m, 30m, 100m and 300m; `ACROSS` is the number of hexes from
west to east; `KIND` is `ground` or `structure`. Each run prints every step with the
seconds since the job started.

The census starts at the saved population and applies the present physical epoch's
human eras. On a settled capture this extends its history. It prints the total
population and the towns the ordinary settlement classifier finds after each era.
`--reference-width` stretches the same terrain to the reference world width,
keeping the demographic cell spacing and aspect ratio. This is a controlled
extent comparison. Both modes leave the kept map untouched and omit political
events, terrain generation and town development.

For a coupled comparison, `census --full-history` runs the kept creation recipe
from formation through final publication in an isolated local directory. Each
epoch prints the live headcount, the last recorded settlement sizes and the
current residents on the largest recorded settlement footprint. Settlement
sizes are reassessed in human eras. In this mode `--reference-width` generates
new terrain at the reference width, and `--seed` selects the world seed.

To diagnose development for one settlement, start the native server with
`ATLAS_TRACE_TOWN=Evorno make local-up` and run the usual real-scale generation.
The server log groups JSON events by town and development round. The
`town.construction-start` event gives the candidate and holding counts.
`town.construction-decision` records the proposed use, its location and the
first check that declined it or its establishment. The `town.street-decision`
events record route demand, proposed endpoints and the reason for rejection
or the effort spent building a route.

The server log (`.artifacts/local-atlas/server.log`) records each generation step and
publication stage as it starts, with the memory the server holds, and the launcher adds
`server.memory` each time that memory grows by another GiB. When the server ends, the
launcher writes `server.exit` with its exit status, what the status means (a SIGKILL from
the out-of-memory killer, an abort, a segmentation fault), its peak memory and the memory
left on the machine. A panic's words go into the job's failure message. Each server start
moves the previous log to the end of `server-history.log`. A harness command following a
job stops as soon as the server process is gone and prints the exit record.

Each job saves a picture of the land, shaded by height with water in blue, after every
world epoch and at the start and after each round of regional development, in
`.artifacts/local-atlas/previews/<job-id>/`; the run prints each path. A change to the
land can be judged without a whole map:
`scripts/local-atlas.sh real --at Ajarma --hex 100m --until "Initial regional detail"`
stops the job after that picture (about half a minute), and `--until "round 1"` after the
first round of development.

`region` selects a rectangle of `--width` metres with a 4:3 aspect ratio. Both `region`
and `real` capture a child, then generate it using its captured configuration. `--parent`
uses the completed map in that result folder; without it, the kept world is the parent.
Settlement names are resolved on that parent, so subsequent selections follow its geography.
`--name` sets the result folder; choose a new name for each run to preserve earlier results.
For a controlled settlement comparison, `real --template surveyors-ring` selects that
template from the site's eligible alternatives. `--major-work library` starts a commission
whose site, design and construction follow the usual major-work rules. Use the same parent,
settlement and hex settings for each comparison.
A finished map is saved to the server library and reported in
`.artifacts/local-atlas/maps/<name>/`:

| File                 | Contents                                                        |
| -------------------- | --------------------------------------------------------------- |
| `summary.txt`        | The map's size, and every published feature kind with its count |
| `map.json`           | The map description                                             |
| `steps.txt`          | Each step with its time                                         |
| `map.png`            | The whole map: water, rivers, fields, plots, ways and buildings at their real size |
| `town.png`           | The same drawing framed on the town with the most occupied buildings |
| `town-centre.png`    | That town's centre, 1.5 km across, where single roofs and street widths show |
| `preview-*.png`      | The job's pictures of the land after each stage                 |
| `preview-town-*.png` | The same town at founding and after early, middle and mature development, in one frame and metre scale, with a close-up of its centre at the last stage |

The report reads the published map through the server's map service, page by page, as
the frontend does. Buildings are coloured by function: residential, civic or economic.
The town development picture compares the stages in two rows at the same scale. The first
shows only buildings, and the second includes streets and land use. To redraw the town
previews from a retained job, run
`scripts/local-atlas.sh town-previews <jobId> --name <map folder>`.

`scripts/local-atlas.sh summary <name>` rewrites a map's report and pictures from the
server, `history <name>` writes what each process recorded doing (`history.json`), and
`raster <name> <layer id>...` saves raster layers as GeoTIFFs, e.g. `terrain` (elevation
and its companion bands) or `raster:finalSurface`.

A failed job keeps its progress. Fix the cause, run `make local-up` to rebuild and
restart the server, and `make local-resume` continues the last job from its last
completed round. A job that completed while its driver was gone only gets its report.
To stop a trial after observing a problem, use
`scripts/local-atlas.sh cancel <jobId>`. After rebuilding with `make local-up`,
`scripts/local-atlas.sh resume <jobId> --name <map folder>` resumes that trial
from its latest checkpoint, including when another job ran more recently.

When generation code changes what a world stores, the kept world may no longer open.
`scripts/local-atlas.sh world --fresh` creates a new one, and
`scripts/local-atlas.sh reset` deletes the volume and every stored file.

## Profiling

`make local-profile SECONDS=30` samples the running server with perf for that many
seconds while a job runs. The host's `perf_event_paranoid` stays restrictive; perf runs
in a container built from `scripts/profile/` with `CAP_PERFMON` in the host PID
namespace, and finds the server by name. Each profile is written to
`.artifacts/local-atlas/profiles/<time>/`: `perf.data` and `report.txt`, the share of
samples per function. `CALL_GRAPH=dwarf` also records unwound call stacks for
`perf report -i perf.data` inside the same image.
