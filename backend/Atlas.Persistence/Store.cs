using Atlas.Domain;
using Npgsql;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using static Atlas.Persistence.Sql;

namespace Atlas.Persistence;

public sealed partial class Store(NpgsqlDataSource source)
{
    public async Task<List<object>> ListWorlds(string owner)
    {
        await using var c = await source.OpenConnectionAsync();
        return await Sql.Read<object>(c, "SELECT id,name,version FROM atlas_worlds WHERE owner=$1 ORDER BY updated_at DESC", r =>
            new { id = r.GetGuid(0), name = r.GetString(1), version = r.GetInt64(2) }, owner);
    }

    internal static async Task<long> OwnedVersion(NpgsqlConnection c, Guid id, string owner, bool locked = false)
    {
        await using var command = Command(c, "SELECT version FROM atlas_worlds WHERE id=$1 AND owner=$2" + (locked ? " FOR UPDATE" : ""), id, owner);
        var version = await command.ExecuteScalarAsync();
        Guard.Require(version is long, "not_found", "World not found.");
        return (long)version!;
    }

    public async Task<World> Read(Guid id, string owner)
    {
        await using var c = await source.OpenConnectionAsync();
        await using var transaction = await c.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
        var w = await ReadVersion(c, id, await OwnedVersion(c, id, owner));
        Constraints.Resolve(w);
        return w;
    }

    public async Task<(World World, int FeatureCount)> Metadata(Guid id, string owner)
    {
        await using var c = await source.OpenConnectionAsync();
        await using var transaction = await c.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
        var version = await OwnedVersion(c, id, owner);
        var w = await ReadVersion(c, id, version, false);
        await using var count = Command(c, "SELECT count(*)::integer FROM atlas_features WHERE scope_id=$1 AND valid_to IS NULL", id);
        return (w, (int)(await count.ExecuteScalarAsync())!);
    }

    public async Task<World> Create(CreateWorld input, string owner)
    {
        var w = Commands.NewWorld(input, owner);
        await using var c = await source.OpenConnectionAsync();
        await using var transaction = await c.BeginTransactionAsync();
        await Insert(c, "atlas_scopes", [("id", w.Id), ("owner", owner), ("kind", "world")]);
        await Insert(c, "atlas_worlds", [("id", w.Id), ("owner", owner), ("name", w.Name), ("version", w.Version)]);
        await SaveWorldRows(c, null, w);
        await transaction.CommitAsync();
        return w;
    }

    public async Task<Proposal> Preview(Guid id, string owner, Atlas.Domain.Command command, string actor)
    {
        await using var c = await source.OpenConnectionAsync();
        await using var transaction = await c.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
        var world = await ReadVersion(c, id, await OwnedVersion(c, id, owner));
        var fields = NeedsFields(command) ? await ReadFields(c, id, world.Fields.Select(f => f.Id)) : [];
        return Commands.Preview(await WithTemplate(c, world, command, owner), command, actor, fields);
    }

    public async Task<Proposal> Commit(Guid id, string owner, Atlas.Domain.Command operation, string actor)
    {
        Guard.Require(operation.Kind != "reconcileBoundary" || operation.Data["confirm"]?.GetValue<bool>() == true,
            "reconciliation_confirmation", "Confirm the impact and current affected-area versions before boundary reconciliation.");
        await using var c = await source.OpenConnectionAsync();
        await using var transaction = await c.BeginTransactionAsync();
        var before = await LockedWorld(c, id, owner);
        var hash = Hash(operation);
        var cached = await ExistingOperation(c, id, operation.OperationId, hash);
        if (cached is not null) return cached;
        var fields = NeedsFields(operation) ? await ReadFields(c, id, before.Fields.Select(f => f.Id)) : [];
        var proposal = Commands.Preview(await WithTemplate(c, before, operation, owner), operation, actor, fields);
        var recipes = PrepareRecipes(before, proposal.Candidate, operation);
        await Register(c, id, Identities(proposal.Candidate));
        await WriteFields(c, id, proposal.Artifacts ?? []);
        await Save(c, before, proposal.Candidate, operation.OperationId, actor, operation.Kind, hash, proposal.Impact);
        foreach (var request in recipes) await InsertJob(c, request.OperationId, id, request);
        await transaction.CommitAsync();
        return proposal;
    }

    public async Task<World> Undo(Guid id, string owner, Atlas.Domain.Command operation, string actor)
    {
        await using var c = await source.OpenConnectionAsync();
        await using var transaction = await c.BeginTransactionAsync();
        var before = await LockedWorld(c, id, owner);
        var cached = await ExistingOperation(c, id, operation.OperationId, Hash(operation));
        if (cached is not null) return cached.Candidate;
        Guard.Require(before.Version == operation.ExpectedVersion, "version_conflict", "Read the latest version before undo.");
        var target = operation.Data["operationId"]!.GetValue<Guid>();
        var rows = await Sql.Read(c, "SELECT before_version,version,actor FROM atlas_operations WHERE world_id=$1 AND operation_id=$2", r =>
            (Before: r.GetInt64(0), Version: r.GetInt64(1), Actor: r.GetString(2)), id, target);
        Guard.Require(rows.Count == 1, "not_found", "Operation not found.");
        var saved = rows[0];
        Guard.Require(saved.Version == before.Version, "undo_conflict", "Undo the latest operation first so later work is preserved.");
        Guard.Require(!actor.StartsWith("agent:", StringComparison.Ordinal) || saved.Actor == actor, "protected_operation", "Agents may undo only their own operations.");
        var restored = await ReadVersion(c, id, saved.Before);
        restored.Version = before.Version + 1;
        foreach (var area in restored.Areas.Values) area.Version = before.Areas.GetValueOrDefault(area.Id)?.Version + 1 ?? 1;
        foreach (var area in restored.Areas.Values.Where(a => a.ParentId is not null && a.Boundary is not null))
            area.Boundary = area.Boundary! with { ParentVersion = restored.Areas[area.ParentId!.Value].Version };
        var impact = new Impact(restored.Features.Keys.Union(before.Features.Keys).ToList(), restored.Areas.Keys.ToList(), restored.Layers.Keys.ToList(), [], true);
        await Save(c, before, restored, operation.OperationId, actor, "undo", Hash(operation), impact);
        await transaction.CommitAsync();
        return restored;
    }

    public async Task<List<object>> History(Guid id, string owner)
    {
        await using var c = await source.OpenConnectionAsync();
        await OwnedVersion(c, id, owner);
        return await Sql.Read<object>(c, "SELECT operation_id,version,actor,kind,impact,created_at FROM atlas_operations WHERE world_id=$1 ORDER BY version DESC LIMIT 100", r =>
            new { operationId = r.GetGuid(0), version = r.GetInt64(1), actor = r.GetString(2), kind = r.GetString(3), impact = r.GetFieldValue<DbImpact>(4).Value(), at = r.GetDateTime(5) }, id);
    }

    private static bool NeedsFields(Atlas.Domain.Command command) => command.Kind is "createArea" or "instantiateTemplate" or "reconcileBoundary" or "sculptField" or "putLandform" or "routeNetwork" ||
        command.Kind == "putFeature" && command.Data["feature"]?["kind"]?.GetValue<string>() == "river";
    internal static string Serialize<T>(T value) => JsonSerializer.Serialize(value, AtlasJson.Options);
    internal static T Deserialize<T>(string value) => JsonSerializer.Deserialize<T>(value, AtlasJson.Options)!;
    internal static string Hash<T>(T value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Serialize(value))));

    internal static async Task<World> LockedWorld(NpgsqlConnection c, Guid id, string owner) => await ReadVersion(c, id, await OwnedVersion(c, id, owner, true));

    private static async Task<Proposal?> ExistingOperation(NpgsqlConnection c, Guid id, Guid operation, string hash)
    {
        var rows = await Sql.Read(c, "SELECT request_hash,version,impact FROM atlas_operations WHERE world_id=$1 AND operation_id=$2", r =>
            (Hash: r.GetString(0), Version: r.GetInt64(1), Impact: r.GetFieldValue<DbImpact>(2).Value()), id, operation);
        if (rows.Count == 0) return null;
        Guard.Require(rows[0].Hash == hash, "idempotency_conflict", "An operation ID cannot be reused for different inputs.");
        return new(await ReadVersion(c, id, rows[0].Version), rows[0].Impact);
    }

    internal static async Task Save(NpgsqlConnection c, World before, World after, Guid operation, string actor, string kind, string hash, Impact impact)
    {
        await using var update = Command(c, "UPDATE atlas_worlds SET version=$1,name=$2,updated_at=now() WHERE id=$3 AND version=$4", after.Version, after.Name, after.Id, before.Version);
        Guard.Require(await update.ExecuteNonQueryAsync() == 1, "version_conflict", "A concurrent edit changed this world.");
        await SaveWorldRows(c, before, after);
        await Insert(c, "atlas_operations", [("world_id", after.Id), ("operation_id", operation), ("version", after.Version), ("before_version", before.Version),
            ("actor", actor), ("kind", kind), ("request_hash", hash), ("impact", DbImpact.From(impact))]);
        await Reindex(c, after, before, impact.Features);
    }
}
