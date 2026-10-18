using Atlas.Domain;
using Atlas.Persistence;

namespace Atlas.Api;

public static class Payloads
{
    public static object Header(World world, IEnumerable<Feature>? features = null, int? featureCount = null) => new
    {
        world.Id,
        world.Name,
        world.Owner,
        world.Seed,
        world.Version,
        world.Reference,
        world.Areas,
        world.Layers,
        world.Entities,
        world.Templates,
        world.Fields,
        world.Generations,
        world.Magic,
        world.HumanEras,
        world.Views,
        world.Epochs,
        world.Connections,
        features = (features ?? []).ToDictionary(f => f.Id),
        featureCount = featureCount ?? world.Features.Count,
        featuresUri = $"/api/worlds/{world.Id}/features"
    };

    public static async Task<object> Metadata(Store store, Guid id, string owner)
    {
        var metadata = await store.Metadata(id, owner);
        return Header(metadata.World, featureCount: metadata.FeatureCount);
    }

    public sealed record NetworkQuery(Guid AreaId, System.Text.Json.Nodes.JsonObject? Geometry = null, int Offset = 0, long? ExpectedVersion = null);
    public static object Network(World world, NetworkQuery query)
    {
        Guard.Require(world.Areas.TryGetValue(query.AreaId, out var area), "missing_area", "Choose a mapped area.");
        Guard.Require(query.Offset >= 0, "invalid_page", "Network offsets must be nonnegative.");
        Guard.Require(query.ExpectedVersion is null || world.Version == query.ExpectedVersion, "version_conflict", "World changed; reload its metadata.");
        var scope = Spatial.Read(query.Geometry ?? area!.Footprint).Intersection(Spatial.Read(area!.Footprint));
        var space = Composition.Space(world, area.Id);
        var matches = world.NetworkReaches.Values.Where(r => world.NetworkNodes[r.Start].SpaceId == space && Spatial.Read(r.Geometry).Intersects(scope)).OrderBy(r => r.Id).ToList();
        var items = matches.Skip(query.Offset).Take(100).ToList();
        var nodes = items.SelectMany(r => new[] { r.Start, r.End }).Distinct().ToDictionary(id => id, id => world.NetworkNodes[id]);
        return new { items, nodes, world.Version, nextOffset = query.Offset + items.Count < matches.Count ? query.Offset + items.Count : (int?)null };
    }

    public static object Proposal(Proposal proposal) => new
    {
        candidate = Header(proposal.Candidate, proposal.Impact.Features.Where(proposal.Candidate.Features.ContainsKey).Select(id => proposal.Candidate.Features[id])),
        proposal.Impact,
        artifacts = proposal.Artifacts?.Select(f => new
        {
            f.Id,
            f.AreaId,
            channels = f.Values.Keys,
            statistics = f.Values.ToDictionary(v => v.Key, v => new { minimum = v.Value.Min(), maximum = v.Value.Max() })
        })
    };

    public static object Features(World world, int offset, long? expectedVersion)
    {
        Guard.Require(offset >= 0, "invalid_page", "Feature offsets must be nonnegative.");
        Guard.Require(expectedVersion is null || expectedVersion == world.Version, "version_conflict", "World changed during feature retrieval; reload its metadata.");
        var items = world.Features.Values.OrderBy(f => f.Id).Skip(offset).Take(100).ToList();
        return new
        {
            items,
            world.Version,
            total = world.Features.Count,
            nextOffset = offset + items.Count < world.Features.Count ? offset + items.Count : (int?)null
        };
    }

    public static object Export(World world, int offset, long? expectedVersion)
    {
        Guard.Require(offset >= 0, "invalid_page", "Export offsets must be nonnegative.");
        Guard.Require(expectedVersion is null || expectedVersion == world.Version, "version_conflict", "World changed during export; restart from its current version.");
        var page = world.Features.Values.OrderBy(f => f.Id).Skip(offset).Take(100).ToList();
        return new
        {
            type = "FeatureCollection",
            worldCrs = world.Reference,
            areas = world.Areas.Values,
            entities = world.Entities.Values,
            layers = world.Layers.Values,
            features = page.Select(f => new
            {
                type = "Feature",
                id = f.Id,
                geometry = Spatial.Write(Composition.Geometry(world, f)),
                properties = new
                {
                    f.Name,
                    f.Kind,
                    f.LayerId,
                    f.AreaId,
                    f.Attributes,
                    f.Relations,
                    f.State,
                    f.Causes,
                    f.GenerationId,
                    f.Detail,
                    sourceGeometry = f.Geometry,
                    spaceId = Composition.Space(world, f.AreaId)
                }
            }),
            world.Connections,
            world.NetworkNodes,
            world.NetworkReaches,
            generation = world.Generations,
            fields = world.Fields,
            world.Version,
            nextOffset = offset + page.Count < world.Features.Count ? offset + page.Count : (int?)null,
            interchange = "Coordinates use the declared fictional engineering CRS, not WGS84. Field references are available through the field API."
        };
    }
}
