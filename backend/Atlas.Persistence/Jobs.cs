using Atlas.Domain;
using Atlas.Generation;
using Npgsql;

namespace Atlas.Persistence;

public sealed record Job(Guid Id, Guid WorldId, string Status, string Stage, double Progress,
    bool CancelRequested, string? Error, int Attempt, DateTime CreatedAt, DateTime UpdatedAt, bool Recoverable);
public sealed record JobLease(Job Job, Guid LeaseId, GenerationInput Input);

public sealed partial class Store
{
    public async Task<Job> Enqueue(Guid worldId, string owner, GenerationRequest request)
    {
        await using var connection = await source.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        var world = await LockedWorld(connection, worldId, owner);
        await using var existing = new NpgsqlCommand("SELECT id,request_hash FROM atlas_jobs WHERE world_id=$1 AND operation_id=$2", connection);
        existing.Parameters.AddWithValue(worldId);
        existing.Parameters.AddWithValue(request.OperationId);
        Guid? cached = null;
        await using (var reader = await existing.ExecuteReaderAsync())
        {
            if (await reader.ReadAsync())
            {
                Guard.Require(reader.GetString(1) == Hash(request), "idempotency_conflict", "Generation operation IDs cannot be reused with different inputs.");
                cached = reader.GetGuid(0);
            }
        }
        if (cached is { } cachedId) return (await Jobs(worldId, owner)).Single(j => j.Id == cachedId);
        Guard.Require(world.Version == request.ExpectedVersion, "version_conflict", "Read the current world before starting generation.");
        Registry.Validate(world, request);
        var id = Guid.NewGuid();
        await InsertJob(connection, id, worldId, request);
        await transaction.CommitAsync();
        return (await Jobs(worldId, owner)).Single(j => j.Id == id);
    }

    public async Task<List<Job>> Jobs(Guid worldId, string owner)
    {
        await using var connection = await source.OpenConnectionAsync();
        await OwnedVersion(connection, worldId, owner);
        await using var command = source.CreateCommand("SELECT id,world_id,status,stage,progress,cancel_requested,error,attempt,created_at,updated_at,COALESCE(status IN ('running','cancelling') AND lease_expires<now(),false) FROM atlas_jobs WHERE world_id=$1 ORDER BY created_at DESC");
        command.Parameters.AddWithValue(worldId);
        await using var reader = await command.ExecuteReaderAsync();
        var result = new List<Job>();
        while (await reader.ReadAsync()) result.Add(ReadJob(reader));
        return result;
    }

    public async Task ControlJob(Guid world, Guid jobId, string owner, bool retry)
    {
        await using var connection = await source.OpenConnectionAsync();
        await OwnedVersion(connection, world, owner);
        var sql = retry
            ? "UPDATE atlas_jobs SET status='queued',stage='Queued for retry',progress=0,error=NULL,cancel_requested=false,lease_owner=NULL,lease_expires=NULL,attempt=attempt+1,updated_at=now() WHERE id=$1 AND world_id=$2 AND (status IN ('queued','failed','cancelled') OR (status IN ('running','cancelling') AND lease_expires<now()))"
            : "UPDATE atlas_jobs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancelling' END,updated_at=now() WHERE id=$1 AND world_id=$2 AND status IN ('queued','running','cancelling')";
        await using var command = source.CreateCommand(sql);
        command.Parameters.AddWithValue(jobId);
        command.Parameters.AddWithValue(world);
        Guard.Require(await command.ExecuteNonQueryAsync() == 1, "job_state", "The job is not in a state that supports this action.");
    }

    public async Task<JobLease?> Claim(Guid? onlyJob = null)
    {
        await using var connection = await source.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using var command = new NpgsqlCommand("SELECT id,world_id,status,stage,progress,cancel_requested,error,attempt,created_at,updated_at,false,operation_id,input_version,area_id,domains,seed,quality FROM atlas_jobs WHERE status='queued' AND NOT cancel_requested AND ($1::uuid IS NULL OR id=$1) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1", connection);
        command.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Uuid, Value = (object?)onlyJob ?? DBNull.Value });
        Job job;
        GenerationRequest request;
        await using (var reader = await command.ExecuteReaderAsync())
        {
            if (!await reader.ReadAsync()) return null;
            job = ReadJob(reader);
            request = new(reader.GetGuid(11), reader.GetInt64(12), reader.GetGuid(13), reader.GetFieldValue<string[]>(14).ToList(), reader.GetInt32(15), reader.GetString(16));
        }
        var lease = Guid.NewGuid();
        await using var update = new NpgsqlCommand("UPDATE atlas_jobs SET status='running',lease_owner=$1,lease_expires=now()+interval '120 seconds',updated_at=now() WHERE id=$2", connection);
        update.Parameters.AddWithValue(lease);
        update.Parameters.AddWithValue(job.Id);
        await update.ExecuteNonQueryAsync();
        var world = await ReadVersion(connection, job.WorldId, request.ExpectedVersion);
        var fields = await ReadFields(connection, job.WorldId, world.Fields.Select(f => f.Id));
        await transaction.CommitAsync();
        return new(job with { Status = "running" }, lease, new(world, request, fields));
    }

    public async Task<bool> Heartbeat(JobLease lease, string stage, double progress)
    {
        await using var command = source.CreateCommand("UPDATE atlas_jobs SET stage=$1,progress=$2,lease_expires=now()+interval '120 seconds',updated_at=now() WHERE id=$3 AND lease_owner=$4 AND status IN ('running','cancelling') RETURNING cancel_requested");
        command.Parameters.AddWithValue(stage);
        command.Parameters.AddWithValue(progress);
        command.Parameters.AddWithValue(lease.Job.Id);
        command.Parameters.AddWithValue(lease.LeaseId);
        var result = await command.ExecuteScalarAsync();
        Guard.Require(result is bool, "lost_lease", "Generation worker lost its publication lease.");
        return (bool)result!;
    }

    public async Task Publish(JobLease lease, GenerationOutput output)
    {
        await using var connection = await source.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        var before = await LockedWorld(connection, lease.Job.WorldId, lease.Input.World.Owner);
        await using var check = new NpgsqlCommand("SELECT cancel_requested FROM atlas_jobs WHERE id=$1 AND lease_owner=$2 AND lease_expires>now() AND status='running' FOR UPDATE", connection);
        check.Parameters.AddWithValue(lease.Job.Id);
        check.Parameters.AddWithValue(lease.LeaseId);
        Guard.Require(await check.ExecuteScalarAsync() is false, "cancelled", "Generation was cancelled or its lease expired before publication.");
        var after = Runner.Merge(before, lease.Input, output, lease.Job.Id);
        await WriteFields(connection, after.Id, output.Fields);
        var impact = new Impact(output.Features.Select(f => f.Id).ToList(), [lease.Input.Request.AreaId], output.Layers, [], false);
        await Save(connection, before, after, lease.Job.Id, "generator", "generate", Hash(lease.Input.Request), impact);
        await using var done = new NpgsqlCommand("UPDATE atlas_jobs SET status='completed',stage='Committed',progress=1,lease_owner=NULL,lease_expires=NULL,updated_at=now() WHERE id=$1", connection);
        done.Parameters.AddWithValue(lease.Job.Id);
        await done.ExecuteNonQueryAsync();
        await transaction.CommitAsync();
    }

    public async Task Fail(JobLease lease, string message, bool cancelled)
    {
        await using var command = source.CreateCommand("UPDATE atlas_jobs SET status=$1,error=$2,stage=$3,lease_owner=NULL,lease_expires=NULL,updated_at=now() WHERE id=$4 AND lease_owner=$5");
        command.Parameters.AddWithValue(cancelled ? "cancelled" : "failed");
        command.Parameters.AddWithValue(message);
        command.Parameters.AddWithValue(cancelled ? "Cancelled; committed geography preserved" : "Failed; committed geography preserved");
        command.Parameters.AddWithValue(lease.Job.Id);
        command.Parameters.AddWithValue(lease.LeaseId);
        await command.ExecuteNonQueryAsync();
    }

    private static Job ReadJob(NpgsqlDataReader reader) => new(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2),
        reader.GetString(3), reader.GetDouble(4), reader.GetBoolean(5), reader.IsDBNull(6) ? null : reader.GetString(6),
        reader.GetInt32(7), reader.GetDateTime(8), reader.GetDateTime(9), reader.GetBoolean(10));

    private static Task InsertJob(NpgsqlConnection c, Guid id, Guid world, GenerationRequest request) => Sql.Insert(c, "atlas_jobs",
        [("id", id), ("world_id", world), ("operation_id", request.OperationId), ("request_hash", Hash(request)), ("input_version", request.ExpectedVersion),
        ("area_id", request.AreaId), ("domains", request.Domains.ToArray()), ("seed", request.Seed), ("quality", request.Quality)]);
}
