using Atlas.Domain;
using System.Security.Cryptography;
using System.Text;

namespace Atlas.Generation;

public sealed record GeneratorContract(string Id, List<Profile> Profiles, List<string> Requires,
    List<string> Produces, List<string> Invalidates, int HaloSamples, string Algorithm);
public sealed record GenerationRequest(Guid OperationId, long ExpectedVersion, Guid AreaId,
    List<string> Domains, int Seed, string Quality = "standard");
public sealed record GenerationInput(World World, GenerationRequest Request, List<FieldData> Fields);
public sealed record GenerationOutput(List<Feature> Features, List<Entity> Entities, List<FieldData> Fields,
    List<string> Layers, List<string> Warnings, List<WaterTransfer>? WaterTransfers = null, List<Connection>? Connections = null);
public sealed record BuiltOutput(List<Feature> Features, List<Entity> Entities, List<Connection> Connections);

public static class Registry
{
    public static readonly List<GeneratorContract> All = [
        new("physical", [Profile.World, Profile.Region, Profile.Local, Profile.Site], [],
            ["elevation", "geology", "climate", "rivers", "lakes"], ["cultures", "sovereignty", "roads"], 16, "canonry-0f62584+bounded-physical-v2"),
        new("magic", Enum.GetValues<Profile>().ToList(), ["elevation"], ["magic", "elevation", "geology", "climate", "rivers", "lakes"], ["cultures", "sovereignty", "roads"], 16, "declarative-magic-v2"),
        new("cultural", [Profile.World, Profile.Region, Profile.Local, Profile.Site], ["elevation", "climate"],
            ["cultures", "languages", "religions", "settlements"], ["sovereignty"], 8, "demographic-routes-v2"),
        new("political", [Profile.World, Profile.Region, Profile.Local, Profile.Site], ["elevation"],
            ["sovereignty", "claims", "control", "administration", "settlements"], [], 4, "historical-frontiers-v2"),
        new("built", Enum.GetValues<Profile>().ToList(), [], ["settlements", "roads", "structures"], [], 2, "located-layout-v1")
    ];

    public static List<GeneratorContract> Validate(World world, GenerationRequest request)
    {
        Guard.Require(world.Areas.ContainsKey(request.AreaId), "missing_area", "Choose a mapped area to generate.");
        Guard.Require(request.Quality is "draft" or "standard" or "fine", "invalid_quality", "Choose draft, standard or fine quality.");
        Guard.Require(request.Domains.Count > 0 && request.Domains.Distinct().Count() == request.Domains.Count,
            "invalid_domains", "Select one or more distinct generation domains.");
        var area = world.Areas[request.AreaId];
        var selected = new List<GeneratorContract>();
        var available = world.Fields.Where(f => IsAncestor(world, f.AreaId, area.Id)).Select(f => f.LayerId)
            .Concat(world.Areas.Values.Where(a => IsAncestor(world, a.Id, area.Id)).SelectMany(a => a.Layers.Where(l => l.Value is not Materialization.Unmaterialized and not Materialization.Stale).Select(l => l.Key)))
            .ToHashSet();
        foreach (var contract in All.Where(c => request.Domains.Contains(c.Id)))
        {
            Guard.Require(contract.Profiles.Contains(area.Profile), "generator_profile", $"{contract.Id} is unavailable for {area.Profile}.");
            Guard.Require(contract.Requires.All(available.Contains), "missing_input", $"{contract.Id} requires {string.Join(", ", contract.Requires.Where(r => !available.Contains(r)))}. Select physical generation or materialize the inputs first.");
            selected.Add(contract);
            available.UnionWith(contract.Produces);
        }
        Guard.Require(selected.Count == request.Domains.Count, "unknown_domain", "A generation domain is not registered.");
        foreach (var other in world.Areas.Values.Where(a => a.Id != area.Id && a.Profile == area.Profile))
        {
            if (Composition.Space(world, other.Id) != Composition.Space(world, area.Id)) continue;
            var owned = selected.SelectMany(c => c.Produces).Any(l => other.Layers.TryGetValue(l, out var state) && state != Materialization.Unmaterialized);
            Guard.Require(!owned || Spatial.Read(area.Footprint).Intersection(Spatial.Read(other.Footprint)).Area <= 1e-8,
                "overlapping_authority", "Selected layers already have same-detail materialization ownership in this extent.");
        }
        return selected;
    }

    public static bool IsAncestor(World world, Guid ancestor, Guid child)
    {
        for (Guid? id = child; id is { } current; id = world.Areas[current].ParentId)
            if (current == ancestor) return true;
        return false;
    }

    public static Guid Identity(Guid world, string name)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{world}:{name}"));
        return new Guid(bytes.AsSpan(0, 16));
    }

    public static int Resolution(string quality) => quality switch { "draft" => 48, "fine" => 192, _ => 96 };
}
