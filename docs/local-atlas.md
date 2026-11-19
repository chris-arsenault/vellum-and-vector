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
  `http://127.0.0.1:44138/`. It also serves that checkout's `frontend/dist`.
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
node scripts/local-atlas.mjs places              # the world's settlements and positions
node scripts/local-atlas.mjs census              # run human land processes on retained world layers
make local-real AT=Ajarma HEX=100m ACROSS=50     # a real-scale map at a settlement
make local-real AT=500000,375000 HEX=300m        # or at a point in world metres
node scripts/local-atlas.mjs region --at Amadir --width 120000 --name Amadir-country
node scripts/local-atlas.mjs region --parent Amadir-country --at Amadir --width 20000 --name Amadir-district
node scripts/local-atlas.mjs real --parent Amadir-district --at Amadir --hex 30m --across 100 --name Amadir-town
make local-resume    # after fixing a failed step: make local-up, then resume the job
make local-down      # stop the server and database; the world stays
```

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
or the effort spent building a route. Copy the log before the next server
start replaces it.

Each job saves a picture of the land, shaded by height with water in blue, after every
world epoch and at the start and after each round of regional development, in
`.artifacts/local-atlas/previews/<job-id>/`; the run prints each path. A change to the
land can be judged without a whole map:
`node scripts/local-atlas.mjs real --at Ajarma --hex 100m --until "Initial regional detail"`
stops the job after that picture (about half a minute), and `--until "round 1"` after the
first round of development.

`region` selects a rectangle of `--width` metres with a 4:3 aspect ratio. Both `region`
and `real` capture a child, then generate it using its captured configuration. `--parent`
uses the completed map in that result folder; without it, the kept world is the parent.
Settlement names are resolved on that parent, so subsequent selections follow its geography.
`--name` sets the result folder; choose a new name for each run to preserve earlier results.
A finished map is saved to the server library and reported in
`.artifacts/local-atlas/maps/<name>/`:

| File            | Contents                                                        |
| --------------- | --------------------------------------------------------------- |
| `summary.txt`   | The map's size, and every published feature kind with its count |
| `map.geojson`   | The GIS export                                                  |
| `map.json`      | The map description                                             |
| `steps.txt`     | Each step with its time                                         |
| `preview-*.png` | The job's pictures of the land after each stage                 |
| `preview-town-*.svg` | The same town at founding and after early, middle and mature development. Each view uses the same bounds and metre scale and shows fields, plots, roads, passages and building footprints. |
| `*.png`         | Pictures from `node scripts/local-atlas.mjs view <name>`        |

The town development SVG compares the stages in two rows at the same scale. The first
shows only buildings, and the second includes streets and land use. To redraw the town
previews from a retained job, run
`node scripts/local-atlas.mjs town-previews <jobId> --name <map folder>`.

`node scripts/local-atlas.mjs summary <name>` rewrites a map's report from the server,
`history <name>` writes what each process recorded doing (`history.json`), and
`raster <name> <layer id>...` saves raster layers as GeoTIFFs, e.g. `terrain` (elevation
and its companion bands) or `raster:finalSurface`.

A failed job keeps its progress. Fix the cause, run `make local-up` to rebuild and
restart the server, and `make local-resume` continues the last job from its last
completed round. A job that completed while its driver was gone only gets its report.
To stop a trial after observing a problem, use
`node scripts/local-atlas.mjs cancel <jobId>`. After rebuilding with `make local-up`,
`node scripts/local-atlas.mjs resume <jobId> --name <map folder>` resumes that trial
from its latest checkpoint, including when another job ran more recently.

When generation code changes what a world stores, the kept world may no longer open.
`node scripts/local-atlas.mjs world --fresh` creates a new one, and
`scripts/local-atlas.sh reset` deletes the volume and every stored file.

## Looking at a map

`node scripts/local-atlas.mjs view <name>` opens the map in the frontend the server hosts
and writes pictures beside its report. Build that frontend once, and again after frontend
changes, with `pnpm --dir frontend run build`. The default build talks to the server.
Viewing generates nothing.
