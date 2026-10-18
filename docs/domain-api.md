# Domain operations

**Historical service contract.** The active frontend calls TypeScript domain
operations directly against browser memory. HTTP, authentication, persistence
and MCP are deferred under [ADR 0003](adr/0003-frontend-session.md). The routes
below describe the earlier prototype and are not required to run the application.

All routes except `/health` require the same platform identity. Worlds are scoped
to the validated Cognito subject. The local Development service has an explicit
loopback-only identity mode; it does not expose that mode in Lambda.

`GET /api/worlds` lists accessible worlds. `POST /api/worlds` accepts
`{name,seed,width,height,traits?}` with dimensions in metres. Read a world at
`GET /api/worlds/{id}`; its CRS, areas, layer definitions, entities, fields,
generation history, templates and semantic feature identities are authoritative.
This response contains metadata and an empty `features` dictionary. Retrieve
`GET .../features?offset=0&expectedVersion=<version>` and follow `nextOffset` until
null. Each page contains `items`, `version` and `total`. Restart retrieval if a
concurrent edit changes the version. This keeps ordinary transport payloads
independent of the number of generated river segments.

`GET .../scene?areaId=<id>&extent=minX,minY,maxX,maxY&expectedVersion=<version>&offset=0` returns paged,
spatially scoped features with canonical composed geometry, matching attributes,
local authorship and space membership. Parent views include committed finer patches;
interior floors do not inherit other floors' room geometry. Raw feature pages retain
the source representation and `detail` dictionary for authoring/provenance. Exports
carry composed geometry plus `sourceGeometry`, detail and `spaceId` metadata.
The extent is optional. Results retain the full composed geometry in the selected
area so editing an on-screen feature cannot erase its off-screen portion.
`GET .../features/{featureId}?areaId=<id>` retrieves a single resolved feature.

`GET .../sample?areaId=<id>&channel=elevation&x=...&y=...` samples the finest
authoritative field covering that point in the selected space and returns `fieldId`.
Field image payloads include a composed coverage `footprint` and original
`sourceFootprint`; rendering uses the former to avoid drawing coarse data over fine
patches. `POST .../network` accepts `areaId,geometry?,offset?,expectedVersion?` and
returns paged reaches plus their endpoint nodes in the selected space. World metadata
does not transfer the whole network. GIS exports retain the full graph.

## Preview and commit

Send the same envelope to `/api/worlds/{id}/preview` or `/commands`:

```json
{
  "operationId": "be4499dc-e4ce-4805-9500-1977e6f7ba7c",
  "expectedVersion": 3,
  "kind": "putFeature",
  "data": {
    "areaId": "de73729f-03c4-4435-a31c-21b00bd880fd",
    "feature": {
      "id": "53fdfcca-f7c2-422a-9a7c-7e1ec528f5ca",
      "name": "Old well",
      "kind": "poi",
      "layerId": "pois",
      "areaId": "de73729f-03c4-4435-a31c-21b00bd880fd",
      "geometry": {"type":"Point","coordinates":[1200,900]},
      "attributes": {},
      "protected": true
    }
  }
}
```

Preview returns a candidate and impact: affected feature/area/layer IDs, derived
invalidations and whether the operation changes shared boundaries. It writes
nothing. Candidate metadata is complete; its `features` dictionary contains only
impacted features. Merge those features into the previous snapshot and remove
impacted IDs absent from the candidate. Commit repeats the validators under a database transaction and checks
the world version. Repeating an operation ID with identical inputs returns the
recorded result; different inputs under that ID fail. A stale version returns 409.
Invalid geometry, constraints or connections return a typed error without partial
changes. Use `X-Atlas-Actor: agent` for an agent actor; protected authored content
and boundary rules apply to that actor.

| Kind | Data |
|---|---|
| `createArea` | `parentId,name,profile,footprint,frame,approach,domains,traits,context,contextFeatureId?` |
| `putFeature` | `areaId,feature`; existing identity creates/changes local detail |
| `routeNetwork` | `areaId,kind,name,waypoints,featureId?,startFeatureId?,endFeatureId?,flow?,liftCause?`; terrain-aware road, river or cave routing with explicit joins |
| `putLandform` | `areaId,name,center,radius,height`; atomically sculpts elevation and creates a named peak/depression |
| `deleteFeature` | `featureId`; contracted or referenced features cannot be deleted |
| `putLayer` | `id,name,family,representation,color,profiles,schema,generator` |
| `putEntity` | `id,name,kind,attributes,relations,origin?:{areaId,feature}`; an empty origin feature ID updates the entity's existing origin or creates one atomically |
| `setHumanEras` | `eras:[{id,years,physicalEpoch?,mobility,politicalCapacity}]`; configure before human generation |
| `setTraits` | `areaId,traits`; inherited hard constraints can only be narrowed |
| `sculptField` | `areaId,channel,center,radius,delta`; edits one materialized field |
| `createField` | `areaId,layerId,resolution,value`; initializes a registered field without a generator |
| `connectSpaces` | `id,kind,a,b,flow`; endpoints have `areaId,position,featureId?` |
| `putMagic` | `id,name,source,radius,strength,propagation,effect,decay,storage,dependsOn,scope` |
| `saveTemplate` | `id,name,profile,parentProfiles,footprint,features,traits,frame` in detached local units |
| `instantiateTemplate` | `templateId,parentId,name,frame,contextFeatureId?,bindings?,entityBindings?,definitionVersion?` |
| `setView` | `id,name,areaId,layers` with visibility, opacity, color, minScale, labels and filter |
| `reconcileBoundary` | `featureId,areaId?,geometry,attributes?,changes?:[{areaId,feature}],connections?` or `sculpt:{areaId,channel,center,radius,delta}`; commit requires `confirm:true,areaVersions` |

Profiles are `world`, `region`, `local`, `site`, `interior`; child rank must increase
but can skip levels. Approaches are `manual`, `procedural`, `blank`. Blank means
intentionally empty, not unmaterialized. A frame declares `origin:{x,y,z}`,
`rotation` in counterclockwise degrees, `metresPerUnit` and nullable `floor`.
All committed geometry is world-space GeoJSON in the declared fictional CRS.
Template geometry alone is detached local space.
Context is `landscape`, `settlement`, `structure` or `cave`. Cave layouts use
substrate, fracture, moisture and glacial history. Located interiors and caves
receive a parent entrance connection; vertical connections retain floor/Z.
Road and river connection endpoints must coincide in world XY; portals may join
nonlocal positions. Rivers retain downstream elevations and contracted discharge.
Uphill authored paths require `liftCause` naming a declared gravity source whose
scope covers the path.
Its gravitational potential must also supply the path's uphill head.

Custom layer `schema` maps attribute names to `{type,required}`; supported types
are string, number and boolean. A custom layer may have `generator:null`.
Trait kinds are `hard`, `tendency`, `derived`, `exception`; exceptions require a
cause and geographic scope. Magic propagation is radial, fracture, cold or ocean;
effects are heat, cold, hardening, coastal or gravity. Dependencies must be acyclic.
Sources present before generation participate in fixed physical epochs. Sources
added afterward start at the present: physical regeneration recomputes their
current environmental effects while preserving historical epoch and ice records.
Ocean propagation follows connected water, fracture propagation follows material
conductance, and stored effects follow crust advection and ice retention.
The magic artifact retains baseline temperature/rock and effective values;
normalized Canonry temperature values are indices, not degrees Celsius.
Selecting magic alone runs the same present physical response as combined
generation, including ice, water and coastal effects. Stored intensity, accumulated
wake and natural reference channels remain independently inspectable.

`GET /api/templates` and `POST /api/templates` read and save the owner's independent
library without requiring a world. Updates send the current definition `version`.
A definition can include `units`, local `entities`, `layers`, `spaces`, access
`sockets`, context `requirements` and a `recipe:{domains,seed,quality}`. Definition
and placement frames compose; metres use scale 1 and feet use .3048. Feature
`areaId` is the empty UUID for the root template space or a local space ID.
Additional floors declare their own footprint/frame and stair or portal sockets.
Sockets attach to actual geometry and name internal peers through `connectsTo`.

Placement remaps local identities, admits parent structure/terrain, and resolves
`bindings` from socket names to existing feature IDs. Required sockets must meet
their targets in world coordinates. Street access requires a connected road.
Recipes enqueue durable generation in the placement transaction; ordinary job
cancellation/retry rules apply. Existing instances retain their content when the
library changes. A newer `definitionVersion` affects the new placement only.

Layer order controls draw order. `filter` searches feature names and attributes;
`labels` displays feature names. `minScale` is the minimum map resolution in metres
per pixel. These saved presentation settings do not alter domain geography.

Boundary reconciliation previews all intersecting areas. Confirm the original
area versions returned by inspection, then commit with that same world version.
Reconciliation changes contracts and marks dependent detail stale while preserving
authored representations. It never silently reruns generation.
Field reconciliation creates a new immutable field and updates descendant edge
contracts in the same commit. Its brush must remain inside its own inherited
boundary; reconcile at the parent field to change that edge. Hard child constraints
remain enforced. Ordinary sculpting rejects changes to descendant edge samples.
Network reconciliation also accepts `changes:[{areaId,feature}]` and
`connections:[Connection]` for a coherent multi-object change. Preview constructs
the complete candidate, follows old/new connected components and dependent
`follows` bindings, and reports every old/new affected extent before confirmation.
Ordinary edits cannot detach a registered connection or shared junction. Stored
detail requiring reconciliation retains authored state and records
`needsReconciliation:true` rather than destroying the authored representation.

Area metadata distinguishes `localTraits` from effective `traits`. `setTraits`
replaces local intent; current ancestors supply the effective hard envelopes.
Feature authorship/protection on a local detail does not protect every other
representation of the same semantic feature. Scalar artifacts carry spatially
bounded authored patches, whose samples survive a change in generation resolution.

## Jobs, fields, queries and undo

`GET /api/generators` returns supported profiles, required/produced/invalidated
facts, halo and algorithm version. `POST /api/worlds/{id}/jobs` accepts
`{operationId,expectedVersion,areaId,domains,seed,quality}`. Quality is draft,
standard or fine. Jobs retain their declared inputs after the browser closes.
`GET .../jobs` lists statuses/stages/progress. `POST .../jobs/{jobId}/cancel` or
`/retry` controls work. Retry uses the original deterministic input snapshot.
Expired worker leases are exposed as `recoverable:true` so a lost worker can be
retried explicitly. Publication still checks the current input contracts and
preserves concurrent authored edits. An authored physical field is retained as
a complete artifact during generation; the generation record includes that warning.

`GET .../fields/{fieldId}/channels` lists field channels;
`GET .../fields/{fieldId}?channel=elevation` returns one channel and its grid/extent
and footprint. Samples include the locked boundary profile; clip display to the
footprint. Field references advertise available channels.
`GET .../fields/{fieldId}/history` returns physical forcing and human era/event
summaries. Human histories retain population counts, movement and territorial
changes; ordinary regeneration preserves completed snapshots.
`POST .../query` accepts `{areaId,geometry,layer?}` and performs an indexed envelope
filter followed by exact intersection with the resolved feature representation.
`POST .../convert` accepts `{areaId,position,direction}` (`toWorld` or `fromWorld`).
`GET .../export?offset=0&expectedVersion=<version>` returns a FeatureCollection page
with `nextOffset`. Follow pages at the same version and concatenate their features.
The editor assembles the download locally. Each page includes world-CRS, hierarchy, layers,
entities, detail links and provenance. These coordinates are not RFC 7946 Earth
longitude/latitude; importing into a conventional GIS requires the companion CRS.

`GET .../history` lists operations with actors and impacts. `POST .../undo` uses
a command envelope with `data:{operationId:<latest-operation-id>}` and the current
expected version. Undo restores that prior coherent state, retains history, and
increments the current version. Undoing an older operation across later edits is
rejected rather than deleting those edits.
Agents may undo their own operations only; undo cannot bypass protection of a
human-authored change.

## MCP

`POST /api/worlds/{id}/analyze` accepts `areaId,operation,geometry?,featureId?,targetFeatureId?,layer?,channel?,distance?,networkKind?`.
Operations are `measure`, `buffer`, `intersect`, `nearby`, `fieldStatistics`,
`dependencies`, `networkPath` and `circulation`. Results include geometry,
measurements with units, affected feature/area identities, network node path and
the world version. Statistics respect composed field coverage and the selected
space. The mean weights samples by clipped control-volume area. River paths are
directed; circulation follows passable doors and passages. Analysis writes no facts.

The authenticated `/mcp` endpoint provides stateless JSON-RPC initialization,
`tools/list` and `tools/call`. Tools read worlds/query features, preview/commit
commands and start/inspect generation through the same services. Supply a platform
bearer token to a client that supports authenticated Streamable HTTP. Remote OAuth
client registration/discovery is a separate integration, not a second domain store.
MCP actors are always recorded as agents and cannot overwrite protected features.
Tools include `list_worlds`, `create_world`, `read_world`, `read_features`,
`read_field`, `read_network`, `query_features`, `export_world`, `preview_change`, `commit_change`,
`undo_change`, `start_generation`, `list_jobs`, `control_job`, `analyze_space`,
`list_templates` and `save_template`. Feature, query and
export tools accept `offset` and `expectedVersion` and return pages. `read_world`
returns metadata; `create_world` takes the world definition in `request`.
