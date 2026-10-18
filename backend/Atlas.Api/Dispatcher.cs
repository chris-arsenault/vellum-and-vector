using Atlas.Domain;
using Atlas.Persistence;

namespace Atlas.Api;

public sealed class Dispatcher
{
    public async Task EnsureRecipesStarted(Proposal proposal, Store store, string owner)
    {
        var ids = proposal.Impact.Areas.Where(proposal.Candidate.Areas.ContainsKey)
            .Select(id => proposal.Candidate.Areas[id].RecipeJobId).OfType<Guid>().ToHashSet();
        if (ids.Count == 0) return;
        foreach (var job in (await store.Jobs(proposal.Candidate.Id, owner)).Where(j => ids.Contains(j.Id))) await EnsureStarted(job);
    }

    public Task EnsureStarted(Job job)
    {
        if (job.Status == "queued")
            Guard.Require(Environment.GetEnvironmentVariable("ATLAS_RUN_WORKER") == "1", "generation_runtime_unconfigured",
                "The job is saved, but deployed generation execution has not been configured. Local development uses the C# runner.");
        return Task.CompletedTask;
    }
}
