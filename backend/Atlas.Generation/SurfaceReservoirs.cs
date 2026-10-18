using Atlas.Domain;

namespace Atlas.Generation;

public sealed record SurfaceReservoir(int Root, List<int> Cells, double Spill = 0, int Outlet = -1);

public static class SurfaceReservoirs
{
    public static void Identify(RegionalGrid grid)
    {
        grid.Reservoirs.Clear();
        grid.LakeRoots.Clear();
        var rank = grid.Order.Select((cell, index) => (cell, index)).ToDictionary(v => v.cell, v => v.index);
        Array.Copy(grid.Receiver, grid.FloodReceiver, grid.Count);
        var depressed = grid.Order.Where(i => !grid.Ocean[i] && !grid.IsChannel(i) && !grid.Waters.Cells.ContainsKey(i) && grid.Routing[i] - grid["elevation"][i] > 1e-6).ToHashSet();
        foreach (var i in depressed)
        {
            var lower = grid.Neighbors(i).Where(n => (n % grid.Field.Width == i % grid.Field.Width || n / grid.Field.Width == i / grid.Field.Width) && depressed.Contains(n) &&
                (grid["elevation"][n] < grid["elevation"][i] || grid["elevation"][n] == grid["elevation"][i] && rank[n] < rank[i]))
                .OrderBy(n => grid["elevation"][n]).ThenBy(n => rank[n]).ToList();
            grid.Receiver[i] = lower.Count > 0 ? lower[0] : -1;
        }
        foreach (var i in depressed.OrderBy(i => grid["elevation"][i]).ThenBy(i => rank[i]))
        {
            var root = grid.Receiver[i] < 0 ? i : grid.LakeRoots[grid.Receiver[i]];
            grid.LakeRoots[i] = root;
            if (!grid.Reservoirs.ContainsKey(root)) grid.Reservoirs[root] = new(root, [], grid.Routing[root], grid.FloodReceiver[root]);
            grid.Reservoirs[root].Cells.Add(i);
        }
        var incoming = new int[grid.Count];
        foreach (var i in grid.Order) if (grid.Receiver[i] >= 0) incoming[grid.Receiver[i]]++;
        var queue = new Queue<int>(grid.Order.Where(i => incoming[i] == 0));
        var headsFirst = new List<int>();
        while (queue.TryDequeue(out var i))
        {
            headsFirst.Add(i);
            if (grid.Receiver[i] >= 0 && --incoming[grid.Receiver[i]] == 0) queue.Enqueue(grid.Receiver[i]);
        }
        Guard.Require(headsFirst.Count == grid.Order.Count, "lake_drainage_cycle", "Lake catchments must drain without cycles.");
        grid.Order.Clear(); grid.Order.AddRange(headsFirst.AsEnumerable().Reverse());
    }

    private sealed class Pool(List<int> cells, double volume)
    {
        public List<int> Cells = cells;
        public double Volume = volume;
    }

    // Equal ultimate flood levels do not connect two underfilled pools across an internal saddle.
    public static (double StorageChange, double Inflow, double Outflow) FillAll(RegionalGrid grid, double[] incoming, double[] captured, double years)
    {
        grid.SpillFlows.Clear();
        var old = grid.LakeRoots.Keys.Sum(i => grid["surfaceStorage"][i] * grid.Measures[i]);
        var pools = grid.Reservoirs.ToDictionary(p => p.Key, p => new Pool(p.Value.Cells.ToList(),
            p.Value.Cells.Sum(i => grid["surfaceStorage"][i] * grid.Measures[i]) + incoming[p.Key]));
        var owners = grid.LakeRoots.ToDictionary();
        var pending = new PriorityQueue<int, (double, int)>();
        foreach (var id in pools.Keys) Enqueue(id);
        double imported = 0, exported = 0;
        while (pending.TryDequeue(out var id, out var scheduled))
        {
            if (!pools.TryGetValue(id, out var pool)) continue;
            var edges = pool.Cells.SelectMany(i => grid.Neighbors(i).Where(n => owners.GetValueOrDefault(n, -1) != id)
                .Select(n => (From: i, To: n, Saddle: Math.Max(grid["elevation"][i], grid["elevation"][n]))))
                .OrderBy(e => e.Saddle).ThenBy(e => e.To).ToList();
            if (edges.Count == 0) continue;
            var edge = edges[0];
            if (Math.Abs(scheduled.Item1 - edge.Saddle) > 1e-8) { Enqueue(id); continue; }
            var capacity = VolumeAt(grid, pool, edge.Saddle);
            if (pool.Volume <= capacity + 1e-7) continue;
            var receiver = Destination(edge.To);
            if (receiver is { } other && other != id)
            {
                var target = pools[other];
                if (target.Volume >= VolumeAt(grid, target, edge.Saddle) - 1e-7)
                {
                    pool.Cells.AddRange(target.Cells); pool.Volume += target.Volume;
                    foreach (var cell in target.Cells) owners[cell] = id;
                    pools.Remove(other); Enqueue(id);
                }
                else
                {
                    var transfer = Math.Min(pool.Volume - capacity, VolumeAt(grid, target, edge.Saddle) - target.Volume);
                    pool.Volume -= transfer; target.Volume += transfer;
                    Record(edge.From, edge.To, transfer);
                    if (grid.Surface is { } routed && routed.Contains(edge.To)) routed.Add(edge.To, transfer, incoming, captured, deliver: false);
                    Enqueue(id); Enqueue(other);
                }
            }
            else if (receiver != id)
            {
                var overflow = pool.Volume - capacity; pool.Volume = capacity;
                Record(edge.From, edge.To, overflow);
                Route(edge.To, overflow); Enqueue(id);
            }
            else
            {
                var returning = grid.Surface is { } surface && surface.Contains(edge.To) ? surface.CellsAlong(edge.To).TakeWhile(i => !owners.ContainsKey(i)).ToHashSet() : new HashSet<int>();
                if (grid.Surface is null)
                {
                    var cursor = edge.To;
                    while (!owners.ContainsKey(cursor) && returning.Add(cursor) && grid.Receiver[cursor] >= 0) cursor = grid.Receiver[cursor];
                }
                foreach (var cell in returning) { pool.Cells.Add(cell); owners[cell] = id; grid.LakeRoots[cell] = id; }
                Enqueue(id);
            }
        }
        foreach (var pool in pools.Values)
        {
            var fixedCells = pool.Cells.Where(i => !grid.Mutable[i] && grid.Original("water", i) == 2).ToList();
            double level;
            if (fixedCells.Count > 0)
            {
                level = fixedCells.Average(i => grid.Original("waterSurface", i));
                var required = VolumeAt(grid, pool, level);
                imported += Math.Max(0, required - pool.Volume); exported += Math.Max(0, pool.Volume - required);
                pool.Volume = required;
            }
            else
            {
                var lo = pool.Cells.Min(i => grid["elevation"][i]);
                var hi = pool.Cells.Max(i => grid.Routing[i]) + pool.Volume / grid.CellArea;
                for (var iteration = 0; iteration < 60; iteration++)
                {
                    var mid = (lo + hi) / 2;
                    if (VolumeAt(grid, pool, mid) > pool.Volume) hi = mid; else lo = mid;
                }
                level = (lo + hi) / 2;
            }
            foreach (var i in pool.Cells)
            {
                grid["surfaceStorage"][i] = Math.Max(0, level - grid["elevation"][i]);
                grid["waterDepth"][i] = grid["surfaceStorage"][i];
                grid["waterSurface"][i] = Math.Max(grid["elevation"][i], level);
                grid.Routing[i] = grid["waterSurface"][i];
                grid["water"][i] = grid["waterDepth"][i] > .05 ? 2 : 0;
            }
        }
        foreach (var root in grid.Reservoirs.Keys.ToList())
            if (owners.TryGetValue(root, out var owner)) grid.Reservoirs[root] = grid.Reservoirs[root] with { Cells = pools[owner].Cells };
        foreach (var (cell, owner) in owners) grid.LakeRoots[cell] = owner;
        return (pools.Values.Sum(p => p.Volume) - old, imported, exported);

        void Enqueue(int id)
        {
            var pool = pools[id];
            var saddle = pool.Cells.SelectMany(i => grid.Neighbors(i).Where(n => owners.GetValueOrDefault(n, -1) != id)
                .Select(n => Math.Max(grid["elevation"][i], grid["elevation"][n]))).DefaultIfEmpty(double.PositiveInfinity).Min();
            if (double.IsFinite(saddle)) pending.Enqueue(id, (saddle, id));
        }

        int? Destination(int cell)
        {
            if (grid.Surface is { } surface && surface.Contains(cell))
            {
                var sink = surface.Destination(cell);
                return sink is { Body: null, Channel: null, External: false } && owners.TryGetValue(sink.Cell, out var owner) ? owner : null;
            }
            while (true)
            {
                if (owners.TryGetValue(cell, out var owner)) return owner;
                if (grid.Receiver[cell] < 0 || !grid.Interior[cell] || grid.IsChannel(cell) || grid.Waters.Cells.ContainsKey(cell) || grid.Ocean[cell]) return null;
                cell = grid.Receiver[cell];
            }
        }
        void Route(int cell, double amount)
        {
            if (grid.Surface is { } surface && surface.Contains(cell)) { exported += surface.Add(cell, amount, incoming, captured); return; }
            while (true)
            {
                grid["flow"][cell] += amount / years / RegionalGrid.SecondsPerYear;
                if (grid.Waters.Cells.TryGetValue(cell, out var body)) { grid.Waters.Basins[body].Supply += amount; return; }
                if (grid.IsChannel(cell)) { captured[cell] += amount; return; }
                if (grid.Receiver[cell] < 0 || !grid.Interior[cell] || grid.Ocean[cell]) { exported += amount; return; }
                Record(cell, grid.Receiver[cell], amount);
                cell = grid.Receiver[cell];
            }
        }
        void Record(int from, int to, double amount) => grid.SpillFlows[(from, to)] =
            grid.SpillFlows.GetValueOrDefault((from, to)) + amount / years / RegionalGrid.SecondsPerYear;
    }

    private static double VolumeAt(RegionalGrid grid, Pool pool, double level) =>
        pool.Cells.Sum(i => Math.Max(0, level - grid["elevation"][i]) * grid.Measures[i]);
}
