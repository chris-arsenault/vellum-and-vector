using Atlas.Domain;
using Atlas.Generation;
using Atlas.Persistence;

namespace Atlas.Api;

public sealed class Worker(Store store, ILogger<Worker> logger)
{
    public async Task Run(Guid? onlyJob, CancellationToken stopping)
    {
        while (!stopping.IsCancellationRequested)
        {
            var lease = await store.Claim(onlyJob);
            if (lease is null)
            {
                if (onlyJob is not null) return;
                await Task.Delay(TimeSpan.FromSeconds(1), stopping);
                continue;
            }
            await Execute(lease, stopping);
            if (onlyJob is not null) return;
        }
    }

    private async Task Execute(JobLease lease, CancellationToken stopping)
    {
        using var work = CancellationTokenSource.CreateLinkedTokenSource(stopping);
        using var heartbeatStop = new CancellationTokenSource();
        var state = new StageState();
        var heartbeat = Heartbeat(lease, state, work, heartbeatStop.Token);
        try
        {
            var output = await Task.Run(() => Runner.Run(lease.Input, lease.Job.Id, async (label, progress) =>
            {
                lock (state) { state.Label = label; state.Progress = progress; }
                if (await store.Heartbeat(lease, label, progress)) work.Cancel();
                work.Token.ThrowIfCancellationRequested();
            }, work.Token), work.Token);
            work.Token.ThrowIfCancellationRequested();
            await store.Publish(lease, output);
        }
        catch (Exception e)
        {
            var cancelled = e is OperationCanceledException || e is DomainException { Code: "cancelled" };
            logger.LogError(e, "Generation {JobId} ended before publication", lease.Job.Id);
            await store.Fail(lease, e is DomainException ? e.Message : cancelled ? "Generation cancelled." : "Generation failed. Inspect the worker logs before retrying.", cancelled);
        }
        finally
        {
            heartbeatStop.Cancel();
            try { await heartbeat; } catch (OperationCanceledException) { }
        }
    }

    private async Task Heartbeat(JobLease lease, StageState state, CancellationTokenSource work, CancellationToken stop)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
        while (await timer.WaitForNextTickAsync(stop))
        {
            string label;
            double progress;
            lock (state) { label = state.Label; progress = state.Progress; }
            try { if (await store.Heartbeat(lease, label, progress)) work.Cancel(); }
            catch (Exception e) { logger.LogError(e, "Generation lease renewal failed"); work.Cancel(); return; }
        }
    }

    private sealed class StageState
    {
        public string Label = "Preparing generation";
        public double Progress;
    }
}
